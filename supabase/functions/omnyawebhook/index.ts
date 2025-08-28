// supabase/functions/omnyawebhook/index.ts

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

// Estructura del cuerpo del webhook
interface WebhookPayload {
  type: string;
  id: string; // locationId
  companyId: string;
  name: string;
  email: string;
  stripeProductId: string;
}

// Estructura de la respuesta del token de ubicación
interface LocationTokenData {
   access_token: string;
    token_type: string;
    expires_in: number;
    scope: string;
    locationId: string;
    planId: string;
    userId: string;
    refresh_token?: string;
}

// Estructura de la respuesta al crear un custom value
interface CustomValue {
    id: string;
    name: string;
    fieldKey: string;
    value: string;
    locationId: string;
}

// Define la estructura de la respuesta completa de la API
interface CustomValueApiResponse {
    customValue: CustomValue;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload = (await req.json()) as WebhookPayload;
    const newLocationId = payload.id;
    const companyId = payload.companyId;

    if (!newLocationId || !companyId) {
      throw new Error('El "id" (locationId) y "companyId" son requeridos.');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // 1. Obtener el token de autorización de la compañía (el que tiene permisos generales)
    const tokenProviderResponse = await fetch(`${supabaseUrl}/functions/v1/ghl-token-provider`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseAnonKey,
            'Authorization': `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({ locationId: 'companyOmnya' }),
    });

    if (!tokenProviderResponse.ok) {
        throw new Error('No se pudo obtener el token de autorización de compañía.');
    }
    const { accessToken: companyAuthToken } = await tokenProviderResponse.json();

    // 2. Usar el token de compañía para solicitar un token específico para la nueva ubicación
    const params = new URLSearchParams({ companyId, locationId: newLocationId });
    const locationTokenResponse = await fetch('https://services.leadconnectorhq.com/oauth/locationToken', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Version': '2021-07-28',
        'Authorization': `Bearer ${companyAuthToken}`,
      },
      body: params.toString(),
    });

    if (!locationTokenResponse.ok) {
        const errorData = await locationTokenResponse.json();
        console.error('Error al obtener token de ubicación de GHL:', errorData);
        throw new Error(errorData.message || 'Error al solicitar el token de la nueva ubicación.');
    }
    
    const locationTokenData = await locationTokenResponse.json() as LocationTokenData;
    const locationAccessToken = locationTokenData.access_token;
    const locationRefreshToken = locationTokenData.refresh_token;

    if (!locationAccessToken || !locationRefreshToken) {
        throw new Error('No se recibió un access_token o refresh_token para la ubicación.');
    }

    // --- NUEVA LÓGICA ---
    // 3. Crear el Custom Value "avance_onboarding" usando el token de la ubicación
    const customValueResponse = await fetch(`https://services.leadconnectorhq.com/locations/${newLocationId}/customValues`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Version': '2021-07-28',
            'Authorization': `Bearer ${locationAccessToken}`, // Usamos el token específico de la ubicación
        },
        body: JSON.stringify({
            name: "avance_onboarding",
            value: "0"
        }),
    });

    if (!customValueResponse.ok) {
        const errorData = await customValueResponse.json();
        console.error("Error al crear el Custom Value:", errorData);
        throw new Error('No se pudo crear el custom value de onboarding.');
    }

    const customValueData = await customValueResponse.json() as { customValue: CustomValueResponse };
    const onboardingCustomValueId = customValueData.customValue.id;

    if (!onboardingCustomValueId) {
        throw new Error("No se recibió un ID para el custom value creado.");
    }
    // --- FIN DE LA NUEVA LÓGICA ---

    // 4. Guardar toda la información en la base de datos
    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { error: dbError } = await supabaseAdmin
      .from('ghl_installations')
      .insert({
        location_id: newLocationId,
        refresh_token: locationRefreshToken,
        company_id: companyId,
        onboarding_custom_value_id: onboardingCustomValueId // Guardamos el nuevo ID
      });

    if (dbError) {
      console.error('Error al guardar en la base de datos:', dbError);
      throw new Error('Los datos fueron procesados pero no se pudieron guardar en la base de datos.');
    }
    
    console.log(`Instalación y custom value creados para la ubicación: ${newLocationId}`);

    // 5. Devolver una respuesta exitosa
    return new Response(JSON.stringify({ success: true, message: `Instalación para la ubicación ${newLocationId} procesada.` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("Error en la ejecución del webhook:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});