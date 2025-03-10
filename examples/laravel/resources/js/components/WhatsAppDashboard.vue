<template>
  <div class="whatsapp-dashboard">
    <div class="sidebar">
      <div class="search-container">
        <input 
          type="text" 
          v-model="searchQuery" 
          placeholder="بحث عن جهة اتصال..." 
          class="search-input"
        />
      </div>
      
      <div class="contact-list">
        <div 
          v-for="contact in filteredContacts" 
          :key="contact.phoneNumber" 
          class="contact-item"
          :class="{ 'active': selectedContact && selectedContact.phoneNumber === contact.phoneNumber }"
          @click="selectContact(contact)"
        >
          <div class="contact-avatar">
            {{ getContactInitial(contact.name) }}
          </div>
          <div class="contact-info">
            <div class="contact-name">{{ contact.name }}</div>
            <div class="contact-number">{{ formatPhoneNumber(contact.phoneNumber) }}</div>
          </div>
          <div class="contact-meta" v-if="contact.unread">
            <span class="unread-badge">{{ contact.unread }}</span>
          </div>
        </div>
        
        <div class="add-contact-btn" @click="showAddContactModal = true">
          <i class="fa fa-plus"></i> إضافة جهة اتصال
        </div>
      </div>
    </div>
    
    <div class="chat-container">
      <template v-if="selectedContact">
        <WhatsAppChat 
          :contactNumber="selectedContact.phoneNumber"
          :contactName="selectedContact.name"
          :autoRefresh="true"
          @message-sent="handleMessageSent"
        />
      </template>
      <div class="empty-chat" v-else>
        <div class="empty-chat-icon">
          <i class="fa fa-comments"></i>
        </div>
        <h3>مرحباً بك في لوحة المحادثات</h3>
        <p>اختر جهة اتصال من القائمة لبدء المحادثة</p>
      </div>
    </div>
    
    <!-- نافذة إضافة جهة اتصال -->
    <div class="modal" v-if="showAddContactModal">
      <div class="modal-content">
        <div class="modal-header">
          <h3>إضافة جهة اتصال جديدة</h3>
          <button class="close-btn" @click="showAddContactModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label for="contactName">الاسم</label>
            <input 
              type="text" 
              id="contactName" 
              v-model="newContact.name" 
              placeholder="أدخل اسم جهة الاتصال"
            />
          </div>
          <div class="form-group">
            <label for="contactPhone">رقم الهاتف</label>
            <input 
              type="text" 
              id="contactPhone" 
              v-model="newContact.phoneNumber" 
              placeholder="أدخل رقم الهاتف بالصيغة الدولية (مثال: 966501234567)"
            />
            <small>أدخل الرقم بدون رمز +</small>
          </div>
          <div class="form-group">
            <label for="contactGroup">المجموعة</label>
            <select id="contactGroup" v-model="newContact.group">
              <option value="">بدون مجموعة</option>
              <option v-for="group in contactGroups" :key="group" :value="group">
                {{ group }}
              </option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="cancel-btn" @click="showAddContactModal = false">إلغاء</button>
          <button class="save-btn" @click="saveContact">حفظ</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import WhatsAppChat from './WhatsAppChat.vue';

export default {
  components: {
    WhatsAppChat
  },
  
  data() {
    return {
      contacts: [
        {
          name: 'أحمد محمد',
          phoneNumber: '966501234567',
          group: 'العملاء',
          unread: 2
        },
        {
          name: 'سارة أحمد',
          phoneNumber: '966512345678',
          group: 'العملاء',
          unread: 0
        },
        {
          name: 'محمد علي',
          phoneNumber: '966523456789',
          group: 'الموردون',
          unread: 0
        }
      ],
      contactGroups: ['العملاء', 'الموردون', 'الموظفون', 'العائلة', 'أصدقاء'],
      selectedContact: null,
      searchQuery: '',
      showAddContactModal: false,
      newContact: {
        name: '',
        phoneNumber: '',
        group: '',
        unread: 0
      }
    };
  },
  
  computed: {
    filteredContacts() {
      if (!this.searchQuery) {
        return this.contacts;
      }
      
      const query = this.searchQuery.toLowerCase();
      return this.contacts.filter(contact => 
        contact.name.toLowerCase().includes(query) ||
        contact.phoneNumber.includes(query)
      );
    }
  },
  
  mounted() {
    // تحميل جهات الاتصال من قاعدة البيانات
    this.loadContacts();
    
    // تحديث حالة الرسائل غير المقروءة كل دقيقة
    setInterval(() => {
      this.updateUnreadMessages();
    }, 60000);
  },
  
  methods: {
    async loadContacts() {
      // هنا يمكنك تحميل جهات الاتصال من API الخاص بك
      // مثال:
      // try {
      //   const response = await axios.get('/api/contacts');
      //   this.contacts = response.data;
      // } catch (error) {
      //   console.error('فشل تحميل جهات الاتصال:', error);
      // }
    },
    
    selectContact(contact) {
      this.selectedContact = contact;
      
      // إعادة تعيين عدد الرسائل غير المقروءة
      if (contact.unread > 0) {
        contact.unread = 0;
      }
    },
    
    getContactInitial(name) {
      return name ? name.charAt(0).toUpperCase() : '?';
    },
    
    formatPhoneNumber(phoneNumber) {
      // تنسيق رقم الهاتف للعرض
      return phoneNumber.replace(/(\d{3})(\d{3})(\d{4})/, '+$1 $2 $3');
    },
    
    async saveContact() {
      // التحقق من صحة البيانات
      if (!this.newContact.name || !this.newContact.phoneNumber) {
        alert('يرجى إدخال الاسم ورقم الهاتف');
        return;
      }
      
      // تنظيف رقم الهاتف (إزالة الرمز + إن وجد)
      this.newContact.phoneNumber = this.newContact.phoneNumber.replace(/^\+/, '');
      
      // إضافة جهة الاتصال الجديدة إلى القائمة
      this.contacts.push({
        name: this.newContact.name,
        phoneNumber: this.newContact.phoneNumber,
        group: this.newContact.group,
        unread: 0
      });
      
      // يمكنك هنا إرسال البيانات إلى API
      // مثال:
      // try {
      //   await axios.post('/api/contacts', this.newContact);
      // } catch (error) {
      //   console.error('فشل حفظ جهة الاتصال:', error);
      // }
      
      // إغلاق النافذة وإعادة تعيين النموذج
      this.showAddContactModal = false;
      this.newContact = {
        name: '',
        phoneNumber: '',
        group: '',
        unread: 0
      };
    },
    
    async updateUnreadMessages() {
      // تحديث عدد الرسائل غير المقروءة لكل جهة اتصال
      // مثال:
      // try {
      //   const response = await axios.get('/api/messages/unread-counts');
      //   const counts = response.data;
      //   
      //   this.contacts.forEach(contact => {
      //     const contactCount = counts.find(c => c.phoneNumber === contact.phoneNumber);
      //     contact.unread = contactCount ? contactCount.count : 0;
      //   });
      // } catch (error) {
      //   console.error('فشل تحديث الرسائل غير المقروءة:', error);
      // }
    },
    
    handleMessageSent() {
      // تحديث البيانات بعد إرسال الرسالة
      this.updateUnreadMessages();
    }
  }
}
</script>

<style scoped>
.whatsapp-dashboard {
  display: flex;
  height: 700px;
  border: 1px solid #ddd;
  border-radius: 10px;
  overflow: hidden;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
}

.sidebar {
  width: 320px;
  background-color: #f8f9fa;
  border-right: 1px solid #ddd;
  display: flex;
  flex-direction: column;
}

.search-container {
  padding: 15px;
  border-bottom: 1px solid #ddd;
}

.search-input {
  width: 100%;
  padding: 10px 15px;
  border-radius: 20px;
  border: 1px solid #ddd;
  font-size: 14px;
}

.contact-list {
  flex: 1;
  overflow-y: auto;
}

.contact-item {
  display: flex;
  align-items: center;
  padding: 12px 15px;
  border-bottom: 1px solid #eee;
  cursor: pointer;
  transition: background-color 0.2s;
}

.contact-item:hover {
  background-color: #f0f0f0;
}

.contact-item.active {
  background-color: #e6f7ff;
}

.contact-avatar {
  width: 45px;
  height: 45px;
  background-color: #128C7E;
  border-radius: 50%;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: bold;
  margin-right: 15px;
}

.contact-info {
  flex: 1;
}

.contact-name {
  font-weight: bold;
  margin-bottom: 4px;
}

.contact-number {
  font-size: 13px;
  color: #777;
}

.contact-meta {
  display: flex;
  align-items: center;
}

.unread-badge {
  background-color: #128C7E;
  color: white;
  border-radius: 50%;
  padding: 4px 8px;
  font-size: 12px;
  min-width: 20px;
  text-align: center;
}

.chat-container {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.empty-chat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #888;
  background-color: #f9f9f9;
  padding: 20px;
  text-align: center;
}

.empty-chat-icon {
  font-size: 60px;
  color: #128C7E;
  margin-bottom: 20px;
}

.add-contact-btn {
  margin: 15px;
  padding: 12px;
  background-color: #128C7E;
  color: white;
  text-align: center;
  border-radius: 5px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.add-contact-btn:hover {
  background-color: #0d7d70;
}

.modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0