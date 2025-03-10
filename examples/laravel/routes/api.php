<?php

use App\Http\Controllers\WhatsAppController;
use Illuminate\Support\Facades\Route;

// مسارات WhatsApp
Route::prefix('whatsapp')->middleware('auth:api')->group(function () {
    // إرسال رسائل
    Route::post('/send', [WhatsAppController::class, 'sendMessage']);
    Route::post('/send-media', [WhatsAppController::class, 'sendMedia']);
    Route::post('/upload-media', [WhatsAppController::class, 'uploadAndSendLater']);
    Route::post('/send-with-media-id', [WhatsAppController::class, 'sendWithMediaId']);
    
    // استقبال رسائل
    Route::get('/messages', [WhatsAppController::class, 'getIncomingMessages']);
    Route::get('/messages/{messageId}', [WhatsAppController::class, 'getIncomingMessage']);
    Route::get('/messages/{messageId}/attachment', [WhatsAppController::class, 'downloadAttachment']);
    
    // تشغيل webhook
    Route::post('/trigger-webhook', [WhatsAppController::class, 'triggerWebhook']);
});
