// src/constants/filterDefinitions.js
// Her filtrenin tam tanımı — tek yerden yönetilsin diye burada.
// Teknik Analiz, Hisse Tarayıcı detay modalı ve takip tablosu
// bu dosyayı kullanır.

export const FILTER_LABELS = {
  haftalik_1: "Haftalık Analiz 1",
  haftalik_2: "Haftalık Analiz 2",
  haftalik_3: "Haftalık Analiz 3",
  gunluk_1:   "Günlük Analiz 1",
};

// Tracked tablosundaki filter_types "HAFTALIK_1" gibi büyük harf kodlar
// kullanıyor, buradaki key'ler ise küçük harf (indicator_snapshots
// kolonlarıyla eşleşsin diye). İkisini de destekliyoruz.
export const FILTER_DEFINITIONS = {
  haftalik_1: "Haftalık INV1(9) 0.5'i yukarı keser • EMA21 fiyatın altında • MACDAS negatif, ya da son 3 mumda 0'ı yukarı kesmiş",
  haftalik_2: "Haftalık INV1(9) 0.5'i yukarı keser • EMA21 fiyatın altında • MACDAS 0'ı yukarı keser • CCI(20) 100'ü yukarı keser",
  haftalik_3: "Haftalık INV1(9) 0.5'i yukarı keser • Fiyat EMA21'i yukarı keser • MACDAS 0'ı yukarı keser • CCI(20) > -100",
  gunluk_1:   "Günlük INV1(13) 0.5'i yukarı keser • EMA21 fiyatın altında • MACDAS > 0 • CCI(20) 100'ü yukarı keser",

  HAFTALIK_1: "Haftalık INV1(9) 0.5'i yukarı keser • EMA21 fiyatın altında • MACDAS negatif, ya da son 3 mumda 0'ı yukarı kesmiş",
  HAFTALIK_2: "Haftalık INV1(9) 0.5'i yukarı keser • EMA21 fiyatın altında • MACDAS 0'ı yukarı keser • CCI(20) 100'ü yukarı keser",
  HAFTALIK_3: "Haftalık INV1(9) 0.5'i yukarı keser • Fiyat EMA21'i yukarı keser • MACDAS 0'ı yukarı keser • CCI(20) > -100",
  GUNLUK_1:   "Günlük INV1(13) 0.5'i yukarı keser • EMA21 fiyatın altında • MACDAS > 0 • CCI(20) 100'ü yukarı keser",
};

// "HAFTALIK_1,GUNLUK_1" gibi virgüllü bir string'i okunur satırlara çevirir.
export function parseFilterTypes(filterTypesStr) {
  if (!filterTypesStr) return [];
  return filterTypesStr.split(",").map(code => ({
    code,
    label: FILTER_LABELS[code.toLowerCase()] || code,
    definition: FILTER_DEFINITIONS[code] || "Tanım bulunamadı.",
  }));
}
