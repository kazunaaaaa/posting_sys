// Google Maps JS API のローダ（1度だけ読み込む）
let promise = null;

export function loadGoogleMaps(apiKey) {
  if (!apiKey) return Promise.reject(new Error('no-key'));
  if (promise) return promise;
  promise = new Promise((resolve, reject) => {
    if (window.google?.maps) return resolve(window.google.maps);
    const cb = '__gmapsReady';
    window[cb] = () => resolve(window.google.maps);
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey
    )}&language=ja&region=JP&callback=${cb}`;
    s.async = true;
    s.defer = true;
    s.onerror = () => reject(new Error('gmaps-load-failed'));
    document.head.appendChild(s);
  });
  return promise;
}
