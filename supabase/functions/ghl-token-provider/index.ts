// supabase/functions/ghl-token-provider/index.ts

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

// Define la estructura esperada del cuerpo de la solicitud
interface RequestBody {
  locationId: string;
}

Deno.serve(async (req) => {
  // Manejo de la solicitud pre-vuelo (CORS)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { locationId } = (await req.json()) as RequestBody;

    if (!locationId) {
      throw new Error('El "locationId" es requerido en el cuerpo de la solicitud.');
    }

    // Crea un cliente de Supabase que puede eludir la seguridad a nivel de fila (RLS)
    // usando la clave de rol de servicio.
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 1. Obtener el refresh_token desde nuestra base de datos
    const { data: installation, error: dbError } = await supabaseAdmin
      .from('ghl_installations')
      .select('refresh_token')
      .eq('location_id', locationId)
      .single(); // .single() espera un solo resultado o ninguno

    if (dbError || !installation) {
      throw new Error(`No se encontró una instalación para la ubicación: ${locationId}. Error: ${dbError?.message}`);
    }

    const refreshToken = installation.refresh_token;

    // 2. Usar el refresh_token para solicitar un nuevo access_token a GHL
    const params = new URLSearchParams();
    params.append('client_id', Deno.env.get('GHL_CLIENT_ID')!);
    params.append('client_secret', Deno.env.get('GHL_CLIENT_SECRET')!);
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', refreshToken);

    const response = await fetch('https://services.leadconnectorhq.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: params,
    });

    const tokenData = await response.json();

    if (!response.ok) {
        throw new Error(tokenData.error_description || 'Error al refrescar el token de GHL');
    }

    // 3. Capturamos el NUEVO refresh_token de la respuesta de GHL
    const newRefreshToken = tokenData.refresh_token;

    // 4. Actualizamos el refresh_token en nuestra base de datos para usarlo la próxima vez
    const { error: updateError } = await supabaseAdmin
      .from('ghl_installations')
      .update({ refresh_token: newRefreshToken })
      .eq('location_id', locationId);
    
    // Si la actualización falla, es un problema serio que debemos registrar
    if (updateError) {
      console.error(`Error CRÍTICO: No se pudo actualizar el refresh token para la ubicación ${locationId}. Error: ${updateError.message}`);
      // Podrías decidir lanzar un error aquí para que el frontend sepa que algo salió mal.
      throw new Error('La sesión pudo ser renovada, pero no se pudo guardar el nuevo token de actualización.');
    }
    
    console.log(`Refresh token actualizado exitosamente para la ubicación: ${locationId}`);
    // --- FIN DE LA NUEVA LÓGICA ---

    // 3. Devolver el nuevo access_token al frontend
    return new Response(JSON.stringify({ accessToken: tokenData.access_token }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});