<?php

namespace App\Console\Commands;

use App\Services\WhatsAppService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

class SyncWhatsAppMessages extends Command
{
    protected $signature = 'whatsapp:sync-messages';
    protected $description = 'مزامنة رسائل WhatsApp الواردة';

    protected $whatsappService;

    public function __construct(WhatsAppService $whatsappService)
    {
        parent::__construct();
        $this->whatsappService = $whatsappService;
    }

    public function handle()
    {
        $this->info('بدء مزامنة رسائل WhatsApp...');
        
        try {
            $result = $this->whatsappService->triggerWebhook();
            
            if (isset($result['success']) && $result['success']) {
                $this->info('تمت المزامنة بنجاح: ' . $result['message']);
            } else {
                $this->error('فشلت المزامنة: ' . ($result['error'] ?? 'خطأ غير معروف'));
            }
        } catch (\Exception $e) {
            $this->error('حدث خطأ أثناء المزامنة: ' . $e->getMessage());
            Log::error('فشلت مزامنة رسائل WhatsApp: ' . $e->getMessage());
        }
        
        $this->info('اكتملت مزامنة رسائل WhatsApp');
    }
}
