import borsapy as bp

def tum_kriterleri_kaydet():
    print("⏳ Tüm İş Yatırım kriterleri çekiliyor...")
    kriterler = bp.screener_criteria()
    
    dosya_adi = "is_yatirim_kriterleri.txt"
    
    with open(dosya_adi, "w", encoding="utf-8") as f:
        f.write("--- İŞ YATIRIM SCREENER TÜM KRİTERLERİ ---\n\n")
        for k in kriterler:
            f.write(f"criteria_{k['id']:<4} | {k['name']}\n")
            
    print(f"✅ Bitti! Tüm liste '{dosya_adi}' dosyasına kaydedildi.")
    print("Dosyayı açıp 'yabancı', 'halka', 'favök', 'yüksek' gibi kelimeleri aratabilirsin.")

if __name__ == "__main__":
    tum_kriterleri_kaydet()