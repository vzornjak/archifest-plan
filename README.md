# ARCHIFEST Plan

Alat koji iz RoomPlan (LiDAR) JSON skeniranja prostorije generira tehnički izvještaj — tlocrt, površine zidova/poda/stropa, otvore, i namještaj — sve obrađeno **lokalno u pregledniku**, bez slanja podataka na server.

## Što radi

- Učitava `.json` export iz RoomPlan-kompatibilnog LiDAR scanner appa (npr. Lagarsoft LiDAR Scanner)
- Uz `scan.json` prima i opcionalni `meta.json` (može oba odjednom) — iz njega čita kompasni `headingDegrees` za pravi sjever i kontrolne površine koje app sam računa
- Izračunava:
  - Površinu poda (iz pravog poligona, ne pretpostavljenog pravokutnika)
  - Bruto i neto površinu zidova (neto = bruto minus otvori, povezano preko `parentIdentifier`)
  - Rekonstruira površinu stropa **po prostoriji**: pod te sobe + višak koji kosina dodaje iznad svoje tlocrtne projekcije (podržava proizvoljan broj kosina po zidu)
  - Detektira zidove s kosinom (`polygonCorners`) i prikazuje kut/dimenzije kosine
- Crta arhitektonski tlocrt (SVG) — uvijek ravan, poravnat s najdužim zidom; Portrait/Landscape prekidač bira orijentaciju (auto prema panelu, reagira odmah na fizičku rotaciju ekrana kad nije ručno postavljen). Kad je sjever poznat, između dvije jednako ravne 180°-rotirane varijante bira se ona gdje je sjever bliže gore. Sjever pokazuje kompasna ruža u legendi
- Kompasna ruža (krug, oznake stupnjeva, N/E/S/W) u legendi ispod tlocrta — pokazuje pravi sjever kad je poznat iz `meta.json`, inače pretpostavljeni
- Vrata s klasičnim simbolom otvaranja (krilo + luk) — strana šarke je konvencija jer sken bilježi samo isOpen; kosi dio zida označen sivo samo na stvarnom rasponu kosine
- Panel "Podaci o skenu" iz meta.json: naziv, datum, koordinate, heading, broj prostorija — koordinate se samo ispisuju, ne šalju se nikamo
- **Prostorija je jedinica izvještaja** (bez Polycam pretplate). RoomPlan-ova podjela se ne koristi kao struktura — cijeli sken dolazi kao jedan `rooms[0]` zapis, pa njegov `roomCount` znači "jedno snimanje", ne jedna prostorija. Alat sam rasterizira pod u finu mrežu, flood-fill pronalazi povezane prostorije (bez vanjske geometrijske biblioteke), klasificira ih glasanjem po tipu namještaja (Kuhinja/Kupaonica/Spavaća/Dnevni boravak/Praonica/Hodnik/Ormar) s geometrijskim vetoima, i tek onda **računa pod, strop i zidove po svakoj prostoriji zasebno**. Dijeli se samo tamo gdje stvarno postoje zidovi koji zatvaraju prostor — otvoreni plan ostaje jedna prostorija.
  - Površine soba normaliziraju se na poligon poda pa im je zbroj točno jednak ukupnom podu; mreža sama po sebi mjeri ~3% manje jer joj trake zidova pojedu ćelije. Sitan kontrolni redak ispod Pregleda ispisuje kvadrature po sobi i njihov zbroj
  - Dijeljeni zid ulazi punom površinom u OBJE sobe (svaka strana treba svoj premaz) — "Zidovi po sobama". Ukupni "Zidovi (neto)" i dalje broje svaki zid jednom
- Namještaj kao opcionalni sloj (isključen po defaultu)
- Ispis / spremanje kao PDF (preko browser print dijaloga)

## Korištenje

Otvori `index.html` u browseru (ili preko GitHub Pages linka), ubaci `.json` fajl (drag & drop ili klik), izvještaj se generira automatski.

## Struktura koda

- `index.html` — samo markup
- `style.css` — sav CSS (ekranska tema + print paleta)
- `geometry.js` — čista logika (parsiranje, geometrija, površine, sjever) bez DOM-a; radi i u Nodeu
- `app.js` — DOM, renderiranje izvještaja i SVG tlocrta, kompasna ruža

I dalje bez build koraka — GitHub Pages servira fajlove kakvi jesu, a alat radi i otvoren direktno s diska (`index.html`).

## Testovi

```
node test/geometry.test.js
```

Testovi koriste sintetičku prostoriju (nikad stvarne skenove klijenata — `.gitignore` blokira `*.json`) i pokrivaju: deduplikaciju, površine iz poligona, neto zidove preko `parentIdentifier`-a s clampom, rekonstrukciju stropa (greben/koljeno/profil), segmentaciju i klasifikaciju soba s dijeljenim zidom, formulu sjevera, **orijentaciju tlocrta** (`planOrientation` — sjever-gore izbor, Portrait/Landscape kao četvrtina okreta, ručni override, ponašanje bez meta.json) i robusnost parsiranja.

Orijentacijska logika je namjerno izdvojena iz `app.js` u `geometry.js` kao čista funkcija: tu su živjeli svi dosadašnji bugovi oko sjevera i rotacije, a dok je bila unutar DOM sloja nije se mogla testirati.

## Tehničke napomene

- Pravi sjever: `scan.json` sam po sebi nema apsolutni smjer (ARKit orijentacija je proizvoljna po sesiji). Računa se kombinacijom `meta.json` → `headingDegrees` i `referenceOriginTransform` rotacije iz `scan.json` (RoomPlan interno poravnava koordinate sa zidovima, a taj transform pamti izvornu orijentaciju sesije): `sjever = heading − refRot + 90°`. Korekcija od +90° je kalibrirana fizičkom provjerom u prostoriji (okretanje dok se tlocrt ne poklopi sa sobom u Landscape načinu, pa očitanje kuta strelice) — app bilježi sirovi CLHeading koji mjeri smjer vrha uređaja, ne kamere (telefon u landscape orijentaciji pri startu skena daje očitanje pomaknuto za 90°). Bez meta.json kompas prati pretpostavljeni sjever (−Z).
- Validacija na stvarnom skenu: površina poda identična appu (28.978 m² = meta), a metin `wallAreaSquareMetres` odgovara našoj bruto površini iz poligona minus svi otvori (41.889 m²) — dakle meta prikazuje *neto* zidove.
- **Strop = pod prostorije + višak kosine.** Raniji model (`prosječni presjek × razmak kosih zidova`) morao je pogoditi dužinu za *cijeli* presjek, uključujući njegov ravni dio — a taj je već točno poznat iz poligona poda. Na stvarnom skenu je to puklo: 2.42 m stub-zid pokraj hodnika postavio je "zabate" 7.83 m jedan od drugoga u sobi dugoj 11.93 m, pa je ispalo 25.54 m² stropa nad podom od 33.34 m² — strop manji od sobe, koji se još i *smanjivao* kad se hodnik doda skenu (30.19 → 25.54).
  Rastavom na ravni dio i kosinu ostaje samo jedna nepoznanica, dužina kosine, i ona se mjeri: to je dužina koljenastog zida, prepoznatog po tome što mu visina odgovara koljenu iz presjeka (na stvarnom skenu 1.649 m naspram 2.483 m svih ostalih zidova). Bez koljenastog zida pada se na `pod × (dužina presjeka / horizontalni raspon)`, što je ujedno i gornja granica.
  Odatle dva jamstva pokrivena testovima: **strop nikad nije manji od poda** i **dodavanje površine nikad ga ne smanjuje**. Za čistu pravokutnu sobu sa zabatima na oba kraja model daje identičan rezultat kao stari (do 1e-12) — razlikuje se samo tamo gdje je stari pucao. Pretpostavka ostaje isti poprečni presjek kroz prostoriju; kad kosi zidovi nisu međusobno paralelni (krov se mijenja u oba smjera) to se ispiše kao upozorenje uz prostoriju
- **Nula mrežnih poziva.** Bez build koraka, bez vanjskih dependencyja, bez CDN-a (sistemski font stack, `-apple-system`/`ui-monospace`), bez karata, geokodiranja, analitike i telemetrije. U cijelom kodu nema nijednog `fetch`/`XMLHttpRequest`/`WebSocket`-a ni vanjskog `src`/`href`/`@import`-a — provjereno grepom i snimkom svih zahtjeva u pregledniku (Playwright): učitavanje stranice traži točno 4 datoteke, sve lokalne, i nijedan zahtjev nakon toga. Radi 100% offline, i iz Pagesa i otvoren direktno s diska. Ni sken ni koordinate iz `meta.json` nikad ne napuštaju uređaj

## Licenca

Vidi [LICENSE](LICENSE).
