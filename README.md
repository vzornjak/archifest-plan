# ARCHIFEST Plan

Alat koji iz RoomPlan (LiDAR) JSON skeniranja prostorije generira tehnički izvještaj — tlocrt, površine zidova/poda/stropa, otvore, i namještaj — sve obrađeno **lokalno u pregledniku**, bez slanja podataka na server.

## Što radi

- Učitava `.json` export iz RoomPlan-kompatibilnog LiDAR scanner appa (npr. Lagarsoft LiDAR Scanner)
- Uz `scan.json` prima i opcionalni `meta.json` (može oba odjednom) — iz njega čita kompasni `headingDegrees` za pravi sjever i kontrolne površine koje app sam računa
- Izračunava:
  - Površinu poda (iz pravog poligona, ne pretpostavljenog pravokutnika)
  - Bruto i neto površinu zidova (neto = bruto minus otvori, povezano preko `parentIdentifier`)
  - Rekonstruira površinu stropa iz profila kosih zidova (podržava proizvoljan broj kosina po zidu)
  - Detektira zidove s kosinom (`polygonCorners`) i prikazuje kut/dimenzije kosine
- Crta arhitektonski tlocrt (SVG) — uvijek ravan, poravnat s najdužim zidom; Portrait/Landscape prekidač bira orijentaciju (auto prema panelu). Sjever pokazuje kompasna ruža u legendi
- Kompasna ruža (krug, oznake stupnjeva, N/E/S/W) u legendi ispod tlocrta; 🧭 gumb uz dopuštenje prikazuje malu živu strelicu s orijentacijom uređaja (iOS/Android, HTTPS)
- Vrata s klasičnim simbolom otvaranja (krilo + luk) — strana šarke je konvencija jer sken bilježi samo isOpen; kosi dio zida označen sivo samo na stvarnom rasponu kosine
- Panel "Podaci o skenu" iz meta.json: naziv, datum, koordinate, adresa (OpenStreetMap Nominatim reverse geocoding) + link na Apple Maps
- Namještaj kao opcionalni sloj (isključen po defaultu)
- Ispis / spremanje kao PDF (preko browser print dijaloga)

## Korištenje

Otvori `index.html` u browseru (ili preko GitHub Pages linka), ubaci `.json` fajl (drag & drop ili klik), izvještaj se generira automatski.

## Struktura koda

- `index.html` — samo markup
- `style.css` — sav CSS (ekranska tema + print paleta)
- `geometry.js` — čista logika (parsiranje, geometrija, površine, sjever) bez DOM-a; radi i u Nodeu
- `app.js` — DOM, renderiranje izvještaja i SVG tlocrta, kompas, živi kompas uređaja

I dalje bez build koraka — GitHub Pages servira fajlove kakvi jesu, a alat radi i otvoren direktno s diska (`index.html`).

## Testovi

```
node test/geometry.test.js
```

Testovi koriste sintetičku prostoriju (nikad stvarne skenove klijenata — `.gitignore` blokira `*.json`) i pokrivaju: deduplikaciju, površine iz poligona, neto zidove preko `parentIdentifier`-a s clampom, rekonstrukciju stropa (greben/koljeno/profil), formulu sjevera i robusnost parsiranja.

## Tehničke napomene

- Pravi sjever: `scan.json` sam po sebi nema apsolutni smjer (ARKit orijentacija je proizvoljna po sesiji). Računa se kombinacijom `meta.json` → `headingDegrees` i `referenceOriginTransform` rotacije iz `scan.json` (RoomPlan interno poravnava koordinate sa zidovima, a taj transform pamti izvornu orijentaciju sesije): `sjever = heading − refRot + 90°`. Korekcija od +90° je kalibrirana fizičkom provjerom kompasom — app bilježi sirovi CLHeading koji mjeri smjer vrha uređaja, ne kamere (telefon u landscape orijentaciji pri startu skena daje očitanje pomaknuto za 90°). Bez meta.json kompas prati pretpostavljeni sjever (−Z).
- Validacija na stvarnom skenu: površina poda identična appu (28.978 m² = meta), a metin `wallAreaSquareMetres` odgovara našoj bruto površini iz poligona minus svi otvori (41.889 m²) — dakle meta prikazuje *neto* zidove.
- Rekonstrukcija stropa pretpostavlja jednostavan produženi profil kroz dužinu prostorije (jednostrešni/dvostrešni krov) — za složenije oblike krova (koji se mijenjaju u oba smjera) ova metoda nije pouzdana
- Bez build koraka, bez dependencyja osim onoga što se učita s CDN-a (Google Fonts). Jedini poziv s podacima: koordinate iz meta.json šalju se OSM Nominatimu radi adrese — sken ostaje lokalno

## Licenca

Vidi [LICENSE](LICENSE).
