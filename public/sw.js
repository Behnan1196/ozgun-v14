// Service Worker for TYT-AYT Coaching Platform
// Handles push notifications and offline functionality

const CACHE_NAME = 'coaching-app-v1';
const urlsToCache = [
  '/',
  '/login',
  '/coach'
  // Removed /manifest.json as it might not exist or be causing issues
];

// Install event - cache resources (with error handling)
self.addEventListener('install', (event) => {
  console.log('📦 [SW] Installing service worker...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('📦 [SW] Opened cache');
        
        // Cache URLs individually to handle failures gracefully
        const cachePromises = urlsToCache.map(url => {
          return cache.add(url).catch(error => {
            console.warn('⚠️ [SW] Failed to cache:', url, error);
            // Don't throw error, just log it
          });
        });
        
        return Promise.all(cachePromises);
      })
      .then(() => {
        console.log('✅ [SW] Service worker installed successfully');
        // Skip waiting to activate immediately
        return self.skipWaiting();
      })
      .catch(error => {
        console.error('❌ [SW] Service worker installation failed:', error);
        // Don't block installation completely
      })
  );
});

// Activate event - take control immediately
self.addEventListener('activate', (event) => {
  console.log('🚀 [SW] Service worker activated');
  event.waitUntil(self.clients.claim());
});

// Fetch event - serve from cache when offline (with fallback)
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Return cached version or fetch from network
        return response || fetch(event.request);
      })
      .catch(() => {
        // If both cache and network fail, return a basic response for navigation requests
        if (event.request.mode === 'navigate') {
          return new Response('App offline', { 
            status: 200, 
            headers: { 'Content-Type': 'text/html' } 
          });
        }
      })
  );
});

// Push event - handle incoming push notifications
self.addEventListener('push', (event) => {
  console.log('📨 [SW] Push notification received:', event);
  
  const notificationIcon = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTEyIDJDMTMuMSAyIDE0IDIuOSAxNCA0VjVDMTcuMyA2IDE5LjggOC43IDE5LjggMTJWMTZMMjEgMTdIMTNIMTFIM1YxNkM0LjIgMTYgNS4yIDE1IDUuMiAxM1Y5QzUuMiA2LjggNy4yIDUgOS40IDVWNEMxMCAyLjkgMTAuOSAyIDEyIDJaTTEyIDIxQzEzLjEgMjEgMTQgMjAuMSAxNCAxOUgxMEMxMCAyMC4xIDEwLjkgMjEgMTIgMjFaIiBmaWxsPSIjNDI4NUY0Ii8+Cjwvc3ZnPgo=';

  const options = {
    body: 'Yeni bir bildirim aldınız',
    icon: notificationIcon,
    badge: notificationIcon,
    vibrate: [200, 100, 200],
    requireInteraction: true,
    actions: [
      {
        action: 'view',
        title: 'Görüntüle',
        icon: notificationIcon
      },
      {
        action: 'dismiss',
        title: 'Kapat'
      }
    ],
    data: {
      timestamp: Date.now(),
      url: '/'
    }
  };

  if (event.data) {
    try {
      const payload = event.data.json();
      
      // Customize notification based on type
      if (payload.type === 'new_coaching_session') {
        options.title = '📅 Yeni Koçluk Seansı';
        options.body = payload.body || `${payload.data?.taskTitle} - ${payload.data?.sessionDate} ${payload.data?.sessionTime}`;
        options.data.url = '/coach';
        options.data.type = 'coaching_session';
        options.data.taskId = payload.data?.taskId;
      } else if (payload.type === 'session_updated') {
        options.title = '🔄 Koçluk Seansı Güncellendi';
        options.body = payload.body;
        options.data.url = '/coach';
        options.data.type = 'session_updated';
        options.data.taskId = payload.data?.taskId;
      } else if (payload.type === 'session_reminder') {
        options.title = '⏰ Koçluk Seansı Hatırlatması';
        options.body = payload.body;
        options.data.url = '/coach';
        options.data.type = 'session_reminder';
        options.requireInteraction = true;
      } else {
        options.title = payload.title || 'Coaching Platform';
        options.body = payload.body || payload.message;
      }
      
      // Add custom data
      if (payload.data) {
        options.data = { ...options.data, ...payload.data };
      }
      
    } catch (error) {
      console.error('❌ [SW] Error parsing push payload:', error);
      options.title = 'Coaching Platform';
      options.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(options.title, options)
  );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
  console.log('👆 [SW] Notification clicked:', event);
  
  event.notification.close();
  
  const action = event.action;
  const data = event.notification.data;
  
  if (action === 'dismiss') {
    return;
  }
  
  // Handle different notification types
  let targetUrl = '/';
  
  if (data.type === 'coaching_session' || data.type === 'session_updated' || data.type === 'session_reminder') {
    targetUrl = '/coach';
  } else if (data.url) {
    targetUrl = data.url;
  }
  
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      // Check if app is already open
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      
      // Open new window if app is not open
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  console.log('🔄 [SW] Background sync triggered:', event.tag);
  
  if (event.tag === 'background-sync') {
    event.waitUntil(
      // Handle background sync tasks here
      console.log('📡 [SW] Performing background sync')
    );
  }
});

// Message event - communication with main thread
self.addEventListener('message', (event) => {
  console.log('💬 [SW] Message received:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
}); 