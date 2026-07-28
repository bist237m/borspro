# python/src/debug_screener_fields.py
# TEŞHİS SCRIPT'İ — kalıcı bir dosya değil, sadece bir kerelik kontrol için.
# Amaç: Screener().run()'ın döndürdüğü TÜM alanları görüp, "Sektör" ya da
# "Halka Açıklık" gibi Temel-Degerler-Ve-Oranlar.aspx sayfasında gördüğümüz
# bilgilerin aslında zaten bu API'den geliyor olup olmadığını anlamak.

import borsapy as bp

def main():
    screener = bp.Screener()
    # Geniş bir filtre koyup tüm hisseleri döndürmesini sağlıyoruz
    screener.add_filter("pe", min=-9999, max=99999)
    df = screener.run()

    print("=" * 60)
    print(f"Toplam hisse sayısı: {len(df)}")
    print("=" * 60)
    print("TÜM KOLONLAR:")
    for col in df.columns:
        print(f"  - {col}")

    print("=" * 60)
    print("THYAO için TÜM alan/değer çiftleri (Sektör = 'Havayolları ve Hizm.' olmalı, İş Yatırım sitesine göre):")
    thyao_row = df[df["symbol"] == "THYAO"]
    if len(thyao_row):
        for col, val in thyao_row.iloc[0].items():
            print(f"  {col}: {val}")
    else:
        print("  THYAO bulunamadı!")

    print("=" * 60)
    print("GARAN için TÜM alan/değer çiftleri (Sektör = 'Bankacılık' olmalı):")
    garan_row = df[df["symbol"] == "GARAN"]
    if len(garan_row):
        for col, val in garan_row.iloc[0].items():
            print(f"  {col}: {val}")
    else:
        print("  GARAN bulunamadı!")


if __name__ == "__main__":
    main()
