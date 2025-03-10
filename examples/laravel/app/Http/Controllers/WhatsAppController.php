<?php

namespace App\Http\Controllers;

use App\Services\WhatsAppService;
use GuzzleHttp\Exception\GuzzleException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;

class WhatsAppController extends Controller
{
    protected $whatsAppService;

    public function __construct(WhatsAppService $whatsAppService)
    {
        $this->whatsAppService = $whatsAppService;
    }

    /**
     * إرسال رسالة نصية
     *
     * @param Request $request
     * @return JsonResponse
     */
    public function sendMessage(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'phone_number' => 'required|string',
            'message' => 'required|string',
        ]);

        if ($validator->fails()) {
            return response()->json(['errors' => $validator->errors()], 422);
        }

        try {
            $result = $this->whatsAppService->sendMessage(
                $request->phone_number,
                $request->message
            );

            return response()->json($result);
        } catch (GuzzleException $e) {
            Log::error('فشل إرسال الرسالة: ' . $e->getMessage());
            return response()->json(['error' => 'فشل إرسال الرسالة', 'details' => $e->getMessage()], 500);
        }
    }

    /**
     * إرسال صورة أو ملف
     *
     * @param Request $request
     * @return JsonResponse
     */
    public function sendMedia(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'phone_number' => 'required|string',
            'caption' => 'nullable|string',
            'file' => 'required|file|max:50000', // 50MB max
        ]);

        if ($validator->fails()) {
            return response()->json(['errors' => $validator->errors()], 422);
        }

        try {
            $result = $this->whatsAppService->sendMedia(
                $request->phone_number,
                $request->file('file'),
                $request->caption
            );

            return response()->json($result);
        } catch (GuzzleException $e) {
            Log::error('فشل إرسال الملف: ' . $e->getMessage());
            return response()->json(['error' => 'فشل إرسال الملف', 'details' => $e->getMessage()], 500);
        }
    }

    /**
     * تحميل ملف وإرساله لاحقاً
     *
     * @param Request $request
     * @return JsonResponse
     */
    public function uploadAndSendLater(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'file' => 'required|file|max:50000', // 50MB max
        ]);

        if ($validator->fails()) {
            return response()->json(['errors' => $validator->errors()], 422);
        }

        try {
            // 1. تحميل الملف
            $uploadResult = $this->whatsAppService->uploadMedia($request->file('file'));
            
            // 2. تخزين معرّف الوسائط في الجلسة أو قاعدة البيانات لاستخدامه لاحقاً
            $mediaId = $uploadResult['id'];
            
            return response()->json([
                'success' => true,
                'media_id' => $mediaId,
                'message' => 'تم تحميل الملف بنجاح، يمكنك إرساله لاحقاً باستخدام معرّف الوسائط'
            ]);
        } catch (GuzzleException $e) {
            Log::error('فشل تحميل الملف: ' . $e->getMessage());
            return response()->json(['error' => 'فشل تحميل الملف', 'details' => $e->getMessage()], 500);
        }
    }

    /**
     * إرسال صورة باستخدام معرّف الوسائط
     *
     * @param Request $request
     * @return JsonResponse
     */
    public function sendWithMediaId(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'phone_number' => 'required|string',
            'media_id' => 'required|string',
            'caption' => 'nullable|string',
        ]);

        if ($validator->fails()) {
            return response()->json(['errors' => $validator->errors()], 422);
        }

        try {
            $result = $this->whatsAppService->sendImage(
                $request->phone_number,
                $request->media_id,
                $request->caption
            );

            return response()->json($result);
        } catch (GuzzleException $e) {
            Log::error('فشل إرسال الصورة: ' . $e->getMessage());
            return response()->json(['error' => 'فشل إرسال الصورة', 'details' => $e->getMessage()], 500);
        }
    }

    /**
     * استقبال الرسائل الواردة
     *
     * @param Request $request
     * @return JsonResponse
     */
    public function getIncomingMessages(Request $request): JsonResponse
    {
        try {
            $params = [
                'startDate' => $request->get('start_date'),
                'endDate' => $request->get('end_date'),
                'phoneNumber' => $request->get('phone_number'),
                'limit' => $request->get('limit', 100),
                'offset' => $request->get('offset', 0),
            ];

            $result = $this->whatsAppService->getIncomingMessages($params);
            return response()->json($result);
        } catch (GuzzleException $e) {
            Log::error('فشل استقبال الرسائل: ' . $e->getMessage());
            return response()->json(['error' => 'فشل استقبال الرسائل', 'details' => $e->getMessage()], 500);
        }
    }

    /**
     * تنزيل مرفق رسالة واردة
     *
     * @param int $messageId
     * @return JsonResponse|mixed
     */
    public function downloadAttachment($messageId)
    {
        try {
            // أولاً، احصل على معلومات الرسالة
            $message = $this->whatsAppService->getIncomingMessage($messageId);
            
            if (isset($message['error'])) {
                return response()->json(['error' => 'الرسالة غير موجودة'], 404);
            }
            
            if (empty($message['attachType']) || empty($message['attachName'])) {
                return response()->json(['error' => 'لا يوجد مرفق لهذه الرسالة'], 400);
            }
            
            // تنزيل المرفق
            $fileContent = $this->whatsAppService->downloadMessageAttachment($messageId);
            
            // إعداد الاستجابة لتنزيل الملف
            return response($fileContent, 200, [
                'Content-Type' => $message['attachType'],
                'Content-Disposition' => 'attachment; filename=' . $message['attachName'],
            ]);
        } catch (GuzzleException $e) {
            Log::error('فشل تنزيل المرفق: ' . $e->getMessage());
            return response()->json(['error' => 'فشل تنزيل المرفق', 'details' => $e->getMessage()], 500);
        }
    }

    /**
     * تشغيل webhook لتحديث الرسائل الواردة
     *
     * @return JsonResponse
     */
    public function triggerWebhook(): JsonResponse
    {
        try {
            $result = $this->whatsAppService->triggerWebhook();
            return response()->json($result);
        } catch (GuzzleException $e) {
            Log::error('فشل تشغيل webhook: ' . $e->getMessage());
            return response()->json(['error' => 'فشل تشغيل webhook', 'details' => $e->getMessage()], 500);
        }
    }
}
