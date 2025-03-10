<?php

return [
    // ...existing code...

    'whatsapp' => [
        'base_url' => env('WHATSAPP_API_URL', 'http://localhost:4000'),
        'api_key' => env('WHATSAPP_API_KEY'),
        'tenant_id' => env('WHATSAPP_TENANT_ID'),
    ],
];
