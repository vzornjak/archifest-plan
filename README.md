# ARCHIFEST Plan

Alat koji iz RoomPlan (LiDAR) JSON skeniranja prostorije generira tehnički izvještaj — tlocrt, površine zidova/poda/stropa, otvore, i namještaj — sve obrađeno **lokalno u pregledniku**, bez slanja podataka na server.

## Što radi

- Učitava `.json` export iz RoomPlan-kompatibilnog LiDAR scanner appa (npr. Lagarsoft LiDAR Scanner)
- Izračunava:
  - Površinu poda (iz pravog poligona, ne pretpostavljenog pravokutnika)
  - Bruto i neto površinu zidova (neto = bruto minus otvori, povezano preko `parentIdentifier`)
  - Rekonstruira površinu stropa iz profila kosih zidova (podržava proizvoljan broj kosina po zidu)
  - Detektira zidove s kosinom (`polygonCorners`) i prikazuje kut/dimenzije kosine
- Crta arhitektonski tlocrt (SVG) — pogled odozgo, s auto-poravnanjem na najduži zid i ručnom rotacijom (±5°, ±90°); kompas se rotira zajedno s tlocrtom
- Namještaj kao opcionalni sloj (isključen po defaultu)
- Ispis / spremanje kao PDF (preko browser print dijaloga)

## Korištenje

Otvori `index.html` u browseru (ili preko GitHub Pages linka), ubaci `.json` fajl (drag & drop ili klik), izvještaj se generira automatski.

## Tehničke napomene

- Konvencija smjera: world +X = istok, world −Z = sjever **vrijedi samo ako je scanner app poravnao koordinate s kompasom (gravityAndHeading)** — inače je orijentacija proizvoljna po sesiji skeniranja. Strelica N zato prati *pretpostavljeni* sjever i rotira se zajedno s tlocrtom; ručnom rotacijom poravnaj tlocrt sa stvarnim stanjem.
- Rekonstrukcija stropa pretpostavlja jednostavan produženi profil kroz dužinu prostorije (jednostrešni/dvostrešni krov) — za složenije oblike krova (koji se mijenjaju u oba smjera) ova metoda nije pouzdana
- Bez build koraka, bez dependencyja osim onoga što se učita s CDN-a (Google Fonts)

## Licenca

Vidi [LICENSE](LICENSE).
