# python/src/net_utils.py
# Ortak ağ yardımcıları — borsapy/TradingView çağrılarını hız sınırına
# takılmadan yapmak için.
#
# NEDEN: TradingView, 10 paralel worker ile art arda istek atınca 429
# (Too Many Requests) döndürüyor. Üstelik 429 furyası sırasında bazı
# istekler "invalid symbol" gibi ALAKASIZ görünen hatalarla da dönüyor —
# bunlar gerçek sembol hatası değil, aşırı yüklenmiş oturumun yan etkisi.
# Bu yüzden her iki hata türünde de tekrar deniyoruz.
#
# Kullanım:
#   from net_utils import throttled_retry
#   df = throttled_retry(lambda: bp.Ticker(symbol).history(period="1y"))

import time
import random
import threading

# Tüm thread'ler arasında paylaşılan hız sınırlayıcı: art arda iki istek
# arasında en az MIN_INTERVAL saniye bırakır, kaç worker olursa olsun.
_rate_lock = threading.Lock()
_last_call = [0.0]

MIN_INTERVAL = 1   # saniye — istekler arası minimum boşluk
MAX_RETRIES  =5


def throttle():
    """Global hız sınırlayıcı — çağıran thread'i gerekirse bekletir."""
    with _rate_lock:
        now = time.time()
        wait = _last_call[0] + MIN_INTERVAL - now
        if wait > 0:
            time.sleep(wait)
        _last_call[0] = time.time()


def is_rate_limit_error(err) -> bool:
    msg = str(err)
    return "429" in msg or "Too Many Requests" in msg


def throttled_retry(fn, max_retries: int = MAX_RETRIES):
    """fn'i hız sınırlayıcıdan geçirerek çağırır; 429'da üstel bekleme ile
    tekrar dener. Tüm denemeler başarısız olursa son hatayı fırlatır."""
    last_err = None
    for attempt in range(max_retries):
        throttle()
        try:
            return fn()
        except Exception as err:
            last_err = err
            if is_rate_limit_error(err):
                time.sleep((2 ** attempt) + random.uniform(0, 1))
                continue
            # 429 furyası sırasında sahte "invalid symbol" hataları çıkabiliyor —
            # bir kere daha şans ver, ısrar ederse gerçek hatadır.
            if attempt == 0:
                time.sleep(1.5)
                continue
            break
    raise last_err
