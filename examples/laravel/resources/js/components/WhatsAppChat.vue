<template>
  <div class="whatsapp-chat">
    <div class="chat-header">
      <h2>محادثات WhatsApp</h2>
    </div>
    
    <div class="chat-messages" ref="messagesContainer">
      <div v-for="message in messages" :key="message.id" :class="['message', message.direction === 'INCOMING' ? 'received' : 'sent']">
        <div class="message-content">
          {{ message.message }}
          
          <!-- عرض المرفقات إن وجدت -->
          <div v-if="message.attachType" class="attachment">
            <img v-if="message.attachType.startsWith('image/')" 
                 :src="`/api/whatsapp/messages/${message.id}/attachment`" 
                 @click="openAttachment(message)" />
                 
            <div v-else class="file-attachment" @click="openAttachment(message)">
              <i class="fa fa-file"></i>
              <span>{{ message.attachName }}</span>
            </div>
          </div>
          
          <div class="message-meta">
            {{ formatDate(message.createdAt) }}
          </div>
        </div>
      </div>
    </div>
    
    <div class="chat-input">
      <form @submit.prevent="sendMessage">
        <textarea v-model="newMessage" placeholder="اكتب رسالة..."></textarea>
        
        <!-- زر إرفاق ملف -->
        <input type="file" id="file-input" @change="handleFileChange" hidden />
        <button type="button" class="attachment-btn" @click="triggerFileInput">
          <i class="fa fa-paperclip"></i>
        </button>
        
        <!-- عرض اسم الملف المرفق -->
        <div v-if="attachedFile" class="attached-file">
          {{ attachedFile.name }}
          <button type="button" @click="removeAttachment">×</button>
        </div>
        
        <button type="submit" :disabled="!phoneNumber || (!newMessage && !attachedFile)">
          إرسال <i class="fa fa-paper-plane"></i>
        </button>
      </form>
    </div>
  </div>
</template>

<script>
export default {
  data() {
    return {
      messages: [],
      newMessage: '',
      attachedFile: null,
      phoneNumber: '', // يتم تعيينها من الخارج
      loading: false,
      page: 1,
      hasMoreMessages: true
    }
  },
  
  props: {
    contactNumber: {
      type: String,
      default: ''
    },
    contactName: {
      type: String,
      default: 'جهة اتصال'
    },
    autoRefresh: {
      type: Boolean,
      default: true
    }
  },

  watch: {
    contactNumber: {
      immediate: true,
      handler(newVal) {
        if (newVal) {
          this.phoneNumber = newVal;
          this.messages = [];
          this.page = 1;
          this.hasMoreMessages = true;
          this.loadMessages();
        }
      }
    }
  },
  
  mounted() {
    this.loadMessages();
    
    // تحديث الرسائل كل 30 ثانية إذا كان التحديث التلقائي مفعّلًا
    if (this.autoRefresh) {
      this.refreshInterval = setInterval(() => {
        this.loadNewMessages();
      }, 30000);
    }

    // إضافة حدث التمرير لتحميل المزيد من الرسائل عند التمرير لأعلى
    this.$refs.messagesContainer.addEventListener('scroll', this.handleScroll);
  },

  beforeDestroy() {
    // تنظيف الفواصل الزمنية عند تدمير المكوّن
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }

    // إزالة حدث التمرير
    this.$refs.messagesContainer.removeEventListener('scroll', this.handleScroll);
  },
  
  methods: {
    // تحميل جميع الرسائل
    async loadMessages() {
      if (this.loading || !this.hasMoreMessages) return;
      
      this.loading = true;
      try {
        const response = await axios.get(`/api/whatsapp/messages`, {
          params: {
            phone_number: this.phoneNumber,
            limit: 20,
            offset: (this.page - 1) * 20
          }
        });
        
        const data = response.data;
        
        if (data.messages && data.messages.length) {
          // إضافة الرسائل مع تجنب التكرار
          data.messages.forEach(message => {
            if (!this.messages.find(m => m.id === message.id)) {
              this.messages.push(message);
            }
          });
          
          this.hasMoreMessages = data.messages.length === 20;
          this.page++;
        } else {
          this.hasMoreMessages = false;
        }
        
        // تمرير إلى أسفل لعرض أحدث الرسائل
        this.$nextTick(() => {
          this.scrollToBottom();
        });
      } catch (error) {
        console.error('فشل تحميل الرسائل:', error);
      } finally {
        this.loading = false;
      }
    },
    
    // تحميل الرسائل الجديدة فقط
    async loadNewMessages() {
      if (!this.phoneNumber) return;

      try {
        // حساب وقت آخر رسالة تم استلامها
        const latestMessage = this.messages.reduce((latest, message) => {
          return !latest || new Date(message.createdAt) > new Date(latest.createdAt) ? message : latest;
        }, null);
        
        const params = {
          phone_number: this.phoneNumber,
          limit: 50
        };
        
        if (latestMessage) {
          params.startDate = new Date(latestMessage.createdAt).toISOString();
        }
        
        const response = await axios.get(`/api/whatsapp/messages`, { params });
        
        const newMessages = response.data.messages || [];
        let hasNew = false;
        
        // إضافة الرسائل الجديدة فقط
        newMessages.forEach(message => {
          if (!this.messages.find(m => m.id === message.id)) {
            this.messages.push(message);
            hasNew = true;
          }
        });
        
        // ترتيب الرسائل حسب التاريخ
        if (hasNew) {
          this.messages.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
          
          // تمرير إلى أسفل لعرض الرسائل الجديدة
          this.$nextTick(() => {
            this.scrollToBottom();
          });
        }
      } catch (error) {
        console.error('فشل تحميل الرسائل الجديدة:', error);
      }
    },
    
    // إرسال رسالة
    async sendMessage() {
      if ((!this.newMessage && !this.attachedFile) || !this.phoneNumber) return;
      
      try {
        let response;
        
        if (this.attachedFile) {
          // إرسال رسالة بمرفق
          const formData = new FormData();
          formData.append('phone_number', this.phoneNumber);
          formData.append('caption', this.newMessage || '');
          formData.append('file', this.attachedFile);
          
          response = await axios.post('/api/whatsapp/send-media', formData, {
            headers: {
              'Content-Type': 'multipart/form-data'
            }
          });
        } else {
          // إرسال رسالة نصية فقط
          response = await axios.post('/api/whatsapp/send', {
            phone_number: this.phoneNumber,
            message: this.newMessage
          });
        }
        
        if (response.data) {
          // إضافة الرسالة المرسلة كرسالة صادرة في المحادثة
          const sentMessage = {
            id: Date.now(), // مؤقتًا، سيتم استبداله بمعرف حقيقي عند التزامن
            message: this.newMessage,
            phoneNumber: this.phoneNumber,
            direction: 'OUTGOING',
            attachType: this.attachedFile ? this.attachedFile.type : null,
            attachName: this.attachedFile ? this.attachedFile.name : null,
            createdAt: new Date().toISOString()
          };
          
          this.messages.push(sentMessage);
          
          // إعادة تعيين حقول الإدخال
          this.newMessage = '';
          this.attachedFile = null;
          
          // تمرير إلى أسفل
          this.$nextTick(() => {
            this.scrollToBottom();
          });
          
          // تشغيل webhook لتحديث الرسائل المرسلة في قاعدة البيانات
          this.triggerWebhook();
        }
      } catch (error) {
        console.error('فشل إرسال الرسالة:', error);
        alert('فشل إرسال الرسالة: ' + (error.response?.data?.error || error.message));
      }
    },
    
    // معالجة حدث اختيار ملف
    handleFileChange(event) {
      const file = event.target.files[0];
      if (file) {
        // التحقق من حجم الملف (تحد 50MB)
        if (file.size > 50 * 1024 * 1024) {
          alert('حجم الملف كبير جدًا. الحد الأقصى هو 50 ميجابايت.');
          event.target.value = null;
          return;
        }
        
        this.attachedFile = file;
      }
    },
    
    // فتح مربع حوار اختيار الملف
    triggerFileInput() {
      document.getElementById('file-input').click();
    },
    
    // إزالة المرفق
    removeAttachment() {
      this.attachedFile = null;
      document.getElementById('file-input').value = null;
    },
    
    // فتح المرفق في نافذة جديدة
    openAttachment(message) {
      const url = `/api/whatsapp/messages/${message.id}/attachment`;
      window.open(url, '_blank');
    },
    
    // تنسيق التاريخ
    formatDate(dateString) {
      const date = new Date(dateString);
      return new Intl.DateTimeFormat('ar-SA', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(date);
    },
    
    // تمرير إلى أسفل المحادثة
    scrollToBottom() {
      const container = this.$refs.messagesContainer;
      container.scrollTop = container.scrollHeight;
    },
    
    // معالجة حدث التمرير لتحميل المزيد من الرسائل
    handleScroll() {
      const container = this.$refs.messagesContainer;
      
      // إذا تم التمرير قريبًا من الأعلى، قم بتحميل المزيد من الرسائل
      if (container.scrollTop < 100 && !this.loading && this.hasMoreMessages) {
        this.loadMessages();
      }
    },
    
    // تشغيل webhook لتحديث الرسائل
    async triggerWebhook() {
      try {
        await axios.post('/api/whatsapp/trigger-webhook', {
          tenant_id: this.tenantId || '1'
        });
      } catch (error) {
        console.error('فشل تشغيل webhook:', error);
      }
    }
  }
}
</script>

<style scoped>
.whatsapp-chat {
  display: flex;
  flex-direction: column;
  height: 600px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  overflow: hidden;
  background-color: #f0f0f0;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
}

.chat-header {
  background-color: #128C7E;
  color: white;
  padding: 15px 20px;
  text-align: center;
}

.chat-header h2 {
  margin: 0;
  font-size: 18px;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 15px;
  display: flex;
  flex-direction: column;
}

.message {
  max-width: 70%;
  margin-bottom: 10px;
  padding: 10px 15px;
  border-radius: 8px;
  position: relative;
  word-break: break-word;
}

.message.sent {
  align-self: flex-end;
  background-color: #DCF8C6;
}

.message.received {
  align-self: flex-start;
  background-color: white;
}

.message-content {
  font-size: 15px;
}

.message-meta {
  font-size: 11px;
  color: #777;
  text-align: right;
  margin-top: 5px;
}

.attachment {
  margin-top: 8px;
  max-width: 100%;
}

.attachment img {
  max-width: 200px;
  max-height: 200px;
  border-radius: 5px;
  cursor: pointer;
}

.file-attachment {
  display: flex;
  align-items: center;
  background-color: rgba(0, 0, 0, 0.05);
  padding: 8px 12px;
  border-radius: 5px;
  cursor: pointer;
}

.file-attachment i {
  margin-right: 8px;
  color: #555;
}

.chat-input {
  padding: 15px;
  background-color: white;
  border-top: 1px solid #e0e0e0;
}

.chat-input form {
  display: flex;
  flex-wrap: wrap;
}

.chat-input textarea {
  flex: 1;
  min-height: 50px;
  max-height: 100px;
  border: 1px solid #ddd;
  border-radius: 20px;
  padding: 10px 15px;
  resize: none;
  font-family: inherit;
  font-size: 15px;
}

.chat-input button {
  margin-left: 10px;
  padding: 0 15px;
  background-color: #128C7E;
  color: white;
  border: none;
  border-radius: 20px;
  cursor: pointer;
  font-size: 15px;
  display: flex;
  align-items: center;
  height: 50px;
}

.chat-input button:disabled {
  background-color: #cccccc;
  cursor: not-allowed;
}

.chat-input button i {
  margin-left: 5px;
}

.attachment-btn {
  width: 50px;
  border-radius: 50% !important;
  padding: 0 !important;
  justify-content: center;
}

.attached-file {
  width: 100%;
  margin: 5px 0 10px;
  padding: 8px 12px;
  background-color: #f0f0f0;
  border-radius: 5px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.attached-file button {
  background: none;
  color: #dc3545;
  border: none;
  font-size: 18px;
  cursor: pointer;
  padding: 0 5px;
  margin: 0;
  height: auto;
}
</style>