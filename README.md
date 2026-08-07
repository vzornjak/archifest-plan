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
- Crta arhitektonski tlocrt (SVG) — uvijek ravan, poravnat s najdužim zidom; Portrait/Landscape prekidač bira orijentaciju (auto prema panelu, reagira odmah na fizičku rotaciju ekrana kad nije ručno postavljen). Kad je sjever poznat, između dvije jednako ravne 180°-rotirane varijante bira se ona gdje je sjever bliže gore. Sjever pokazuje kompasna ruža u legendi
- Kompasna ruža (krug, oznake stupnjeva, N/E/S/W) u legendi ispod tlocrta; 🧭 gumb uz dopuštenje prikazuje malu živu strelicu koja pokazuje **pravi sjever u odnosu na uređaj** (kao pravi kompas — gledaš na sjever, strelica gore), neovisno o rotaciji tlocrta; kad se strelica poklopi s N oznakom na ruži, tlocrt odgovara prostoriji. Uz kompenzaciju fizičke rotacije ekrana i dijagnostičke brojke za kalibraciju
- Vrata s klasičnim simbolom otvaranja (krilo + luk) — strana šarke je konvencija jer sken bilježi samo isOpen; kosi dio zida označen sivo samo na stvarnom rasponu kosine
- Panel "Podaci o skenu" iz meta.json: naziv, datum, koordinate, adresa (OpenStreetMap Nominatim reverse geocoding) + link na Apple Maps
- **Segmentacija i klasifikacija soba** (bez Polycam pretplate) — raw RoomPlan JSON daje samo grube `sections` točke, ne prave granice soba. Alat sam rasterizira pod u finu mrežu i flood-fill pronalazi povezane prostorije (bez vanjske geometrijske biblioteke), zatim ih klasificira glasanjem po tipu namještaja (Kuhinja/Kupaonica/Spavaća/Dnevni boravak/Praonica/Hodnik/Ormar) s geometrijskim vetoima. Panel "Zone / Prostorije" prikazuje po sobi: površinu poda, popis namještaja, i **tablicu zidova s površinama** — dijeljeni zid između dvije sobe ulazi punom površinom u OBJE (svaka strana treba svoj premaz), dok ukupni bruto/neto zbroj u Pregledu ostaje kao dosad (jednom po zidu)
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

Testovi koriste sintetičku prostoriju (nikad stvarne skenove klijenata — `.gitignore` blokira `*.json`) i pokrivaju: deduplikaciju, površine iz poligona, neto zidove preko `parentIdentifier`-a s clampom, rekonstrukciju stropa (greben/koljeno/profil), segmentaciju i klasifikaciju soba s dijeljenim zidom, formulu sjevera, **orijentaciju tlocrta** (`planOrientation` — sjever-gore izbor, Portrait/Landscape kao četvrtina okreta, ručni override, ponašanje bez meta.json) i robusnost parsiranja.

Orijentacijska logika je namjerno izdvojena iz `app.js` u `geometry.js` kao čista funkcija: tu su živjeli svi dosadašnji bugovi oko sjevera i rotacije, a dok je bila unutar DOM sloja nije se mogla testirati.

## Tehničke napomene

- Pravi sjever: `scan.json` sam po sebi nema apsolutni smjer (ARKit orijentacija je proizvoljna po sesiji). Računa se kombinacijom `meta.json` → `headingDegrees` i `referenceOriginTransform` rotacije iz `scan.json` (RoomPlan interno poravnava koordinate sa zidovima, a taj transform pamti izvornu orijentaciju sesije): `sjever = heading − refRot + 90°`. Korekcija od +90° je kalibrirana fizičkom provjerom u prostoriji (okretanje dok se tlocrt ne poklopi sa sobom u Landscape načinu, pa očitanje kuta strelice) — app bilježi sirovi CLHeading koji mjeri smjer vrha uređaja, ne kamere (telefon u landscape orijentaciji pri startu skena daje očitanje pomaknuto za 90°). Bez meta.json kompas prati pretpostavljeni sjever (−Z).
- Validacija na stvarnom skenu: površina poda identična appu (28.978 m² = meta), a metin `wallAreaSquareMetres` odgovara našoj bruto površini iz poligona minus svi otvori (41.889 m²) — dakle meta prikazuje *neto* zidove.
- Rekonstrukcija stropa pretpostavlja jednostavan produženi profil kroz dužinu prostorije (jednostrešni/dvostrešni krov) — za složenije oblike krova (koji se mijenjaju u oba smjera) ova metoda nije pouzdana
- Bez build koraka, bez vanjskih dependencyja i bez CDN-a (sistemski font stack, `-apple-system`/`ui-monospace`) — radi 100% offline od prvog otvaranja. Jedini poziv s podacima: koordinate iz meta.json šalju se OSM Nominatimu radi adrese — sken ostaje lokalno

## Licenca

Vidi [LICENSE](LICENSE).
