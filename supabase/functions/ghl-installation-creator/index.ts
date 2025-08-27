// supabase/functions/ghl-installation-creator/index.ts

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

// Define la estructura esperada del cuerpo de la solicitud
interface RequestBody {
  location_id: string;
  refresh_token: string;
}

Deno.serve(async (req) => {
  // Manejo de la solicitud pre-vuelo (CORS)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { location_id, refresh_token } = (await req.json()) as RequestBody;

    if (!location_id || !refresh_token) {
      throw new Error('Los campos "location_id" y "refresh_token" son requeridos.');
    }

    // Crea un cliente de Supabase que puede eludir la seguridad a nivel de fila (RLS)
    // usando la clave de rol de servicio.
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Insertar el nuevo registro en la tabla ghl_installations
    const { data, error } = await supabaseAdmin
      .from('ghl_installations')
      .insert([{ location_id, refresh_token }])
      .select();

    if (error) {
      throw error;
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 201, // 201 Creado
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});