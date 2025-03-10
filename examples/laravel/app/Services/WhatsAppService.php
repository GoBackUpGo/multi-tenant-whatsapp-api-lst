<?php

namespace App\Services;

use GuzzleHttp\Client;
use GuzzleHttp\Exception\GuzzleException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Log;

class WhatsAppService
{
    protected $client;
    protected $baseUrl;
    protected $apiKey;

    public function __construct()
    {
        $this->baseUrl = config('services.whatsapp.base_url', 'http://localhost:4000');
        $this->apiKey = config('services.whatsapp.api_key');

        $this->client = new Client([
            'base_uri' => $this->baseUrl,
            'headers' => [
                'x-api-key' => $this->apiKey,
                'Accept' => 'application/json'
            ]
        ]);
    }

    /**
     * إرسال رسالة نصية
     *
     * @param string $phoneNumber رقم الهاتف بصيغة دولية (مثل: 966501234567)
     * @param string $message نص الرسالة
     * @return array
     * @throws GuzzleException
     */
    public function sendMessage(string $phoneNumber, string $message): array
    {
        try {
            $response = $this->client->post('/messages/send', [
                'json' => [
                    'phoneNumber' => $phoneNumber,
                    'message' => $message
                ]
            ]);

            return json_decode($response->getBody()->getContents(), true);
        } catch (GuzzleException $e) {
            Log::error('فشل إرسال رسالة WhatsApp: ' . $e->getMessage());
            throw $e;
        }
    }

    /**
     * إرسال مرفق (صورة، مستند، فيديو)
     *
     * @param string $phoneNumber رقم الهاتف
     * @param UploadedFile $file الملف المراد إرساله
     * @param string|null $caption تعليق اختياري
     * @return array
     * @throws GuzzleException
     */
    public function sendMedia(string $phoneNumber, UploadedFile $file, ?string $caption = null): array
    {
        try {
            $response = $this->client->post('/messages/send-attch', [
                'multipart' => [
                    [
                        'name' => 'phoneNumber',
                        'contents' => $phoneNumber
                    ],
                    [
                        'name' => 'message',
                        'contents' => $caption ?? ''
                    ],
                    [
                        'name' => 'file',
                        'contents' => fopen($file->getPathname(), 'r'),
                        'filename' => $file->getClientOriginalName(),
                        'headers' => [
                            'Content-Type' => $file->getMimeType()
                        ]
                    ]
                ]
            ]);

            return json_decode($response->getBody()->getContents(), true);
        } catch (GuzzleException $e) {
            Log::error('فشل إرسال مرفق WhatsApp: ' . $e->getMessage());
            throw $e;
        }
    }

    /**
     * تحميل ملف وسائط مسبقاً
     *
     * @param UploadedFile $file الملف المراد تحميله
     * @return array يحتوي على معرف الوسائط
     * @throws GuzzleException
     */
    public function uploadMedia(UploadedFile $file): array
    {
        try {
            $response = $this->client->post('/messages/media/upload', [
                'multipart' => [
                    [
                        'name' => 'file',
                        'contents' => fopen($file->getPathname(), 'r'),
                        'filename' => $file->getClientOriginalName(),
                        'headers' => [
                            'Content-Type' => $file->getMimeType()
                        ]
                    ]
                ]
            ]);

            return json_decode($response->getBody()->getContents(), true);
        } catch (GuzzleException $e) {
            Log::error('فشل رفع ملف وسائط: ' . $e->getMessage());
            throw $e;
        }
    }

    /**
     * إرسال صورة بعد تحميلها مسبقاً
     *
     * @param string $phoneNumber رقم الهاتف
     * @param string $mediaId معرّف الوسائط
     * @param string|null $caption تعليق اختياري
     * @return array
     * @throws GuzzleException
     */
    public function sendImage(string $phoneNumber, string $mediaId, ?string $caption = null): array
    {
        try {
            $response = $this->client->post('/messages/image', [
                'json' => [
                    'to' => $phoneNumber,
                    'mediaId' => $mediaId,
                    'caption' => $caption ?? ''
                ]
            ]);

            return json_decode($response->getBody()->getContents(), true);
        } catch (GuzzleException $e) {
            Log::error('فشل إرسال صورة WhatsApp: ' . $e->getMessage());
            throw $e;
        }
    }

    /**
     * استقبال الرسائل الواردة
     *
     * @param array $params معلمات للتصفية (startDate, endDate, phoneNumber, limit, offset)
     * @return array
     */
    public function getIncomingMessages(array $params = []): array
    {
        try {
            $response = $this->client->get('/messages/incoming', [
                'query' => $params
            ]);

            return json_decode($response->getBody()->getContents(), true);
        } catch (GuzzleException $e) {
            Log::error('فشل استقبال الرسائل: ' . $e->getMessage());
            return ['error' => $e->getMessage()];
        }
    }

    /**
     * استقبال رسالة واردة محددة
     *
     * @param int $messageId معرّف الرسالة
     * @return array
     */
    public function getIncomingMessage(int $messageId): array
    {
        try {
            $response = $this->client->get("/messages/incoming/{$messageId}");
            return json_decode($response->getBody()->getContents(), true);
        } catch (GuzzleException $e) {
            Log::error('فشل استقبال الرسالة: ' . $e->getMessage());
            return ['error' => $e->getMessage()];
        }
    }

    /**
     * تنزيل مرفق رسالة واردة
     *
     * @param int $messageId معرّف الرسالة
     * @return string محتويات الملف
     */
    public function downloadMessageAttachment(int $messageId): string
    {
        try {
            $response = $this->client->get("/messages/incoming/{$messageId}", [
                'query' => ['downloadAttachment' => 'true'],
                'headers' => ['Accept' => '*/*']
            ]);

            return $response->getBody()->getContents();
        } catch (GuzzleException $e) {
            Log::error('فشل تنزيل مرفق الرسالة: ' . $e->getMessage());
            throw $e;
        }
    }

    /**
     * استدعاء webhook لتحديث الرسائل الواردة
     *
     * @return array
     */
    public function triggerWebhook(): array
    {
        try {
            $response = $this->client->post('/messages/webhook', [
                'json' => ['tenantId' => config('services.whatsapp.tenant_id')]
            ]);

            return json_decode($response->getBody()->getContents(), true);
        } catch (GuzzleException $e) {
            Log::error('فشل استدعاء webhook: ' . $e->getMessage());
            return ['error' => $e->getMessage()];
        }
    }
}
