// Generirano iz github.com/stepanic/flutter_moja_mreza (extension/tools/bookmarklet.mjs).
// Ne mijenjati ovdje: izvor su extension/uvoz.js, mojracun.js, hepi.js i bookmarklet.js.
// ---- uvoz.js ----
// Uvoz s Moje mre\u017ee (https://mojamreza.hep.hr) u pregledniku.
//
// Isti tok i isti JSON kao FlutterMojaMreza.uvezi() / HepUvoz.toJson() u
// pluginu, a parsiranje je prijepis lib/src/parser.dart. Radi samo u kontekstu
// stranice mojamreza.hep.hr (fetch je same-origin, ide s cookiejima sesije).
//
// Extension ovu datoteku ubacuje u karticu (chrome.scripting) i zove
// mojaMrezaUvoz(). Mo\u017ee se i zalijepiti u konzolu prijavljene stranice:
//   await mojaMrezaUvoz()

// Sve je u IIFE-u jer extension datoteku mo\u017ee ubaciti u istu karticu vi\u0161e puta.
(() => {
  class MojaMrezaIznimka extends Error {
    /** @param {'sesijaIstekla'|'neocekivanHtml'|'mreza'} greska */
    constructor(greska, poruka) {
      super(poruka ? `${greska}: ${poruka}` : greska);
      this.greska = greska;
    }
  }

  const MojaMrezaParser = (() => {
    const tekst = (e) => (e.textContent || '').replace(/\s+/g, ' ').trim();
    const znamenke = (s) => (s == null ? null : s.replace(/\D/g, ''));

    // `1.234` i `1 234` su tisu\u0107e; HEP daje cijele kWh.
    const broj = (s) => {
      const z = znamenke(s);
      return z == null || z === '' ? null : parseInt(z, 10);
    };

    // `dd.mm.yyyy.` \u2192 `yyyy-mm-dd`.
    const datum = (s) => {
      const m = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s || '');
      if (!m) return null;
      return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    };

    const dokument = (izvor) =>
      typeof izvor === 'string' ? new DOMParser().parseFromString(izvor, 'text/html') : izvor;

    // Prva tablica \u010diji thead sadr\u017ei sve obavezne stupce. Stupci se tra\u017ee po
    // nazivu (po\u010detak, mala slova), ne po indeksu.
    function tablica(d, obavezni) {
      for (const t of d.querySelectorAll('table')) {
        const stupci = new Map();
        t.querySelectorAll('thead th').forEach((th, i) => stupci.set(tekst(th).toLowerCase(), i));
        const kljucevi = [...stupci.keys()];
        if (!obavezni.every((o) => kljucevi.some((k) => k.startsWith(o)))) continue;

        const retci = [...t.querySelectorAll('tbody tr')]
          // Prvi stupac retka je \u010desto <th scope="row"> (OMM na /Postavke,
          // ikona statusa na /Ocitanja), pa se broje i th i td.
          .map((tr) => [...tr.children].filter((c) => /^t[hd]$/i.test(c.tagName)).map(tekst))
          .filter((r) => r.some(Boolean));

        const celija = (redak, naziv) => {
          const k = kljucevi.find((k) => k.startsWith(naziv));
          const v = k == null ? undefined : redak[stupci.get(k)];
          return v ? v : null;
        };
        return { retci, celija };
      }
      throw new MojaMrezaIznimka('neocekivanHtml', `nema tablice sa stupcima ${obavezni.join(', ')}`);
    }

    return {
      /** `/Postavke`: svi OMM-ovi prijavljene osobe. OIB se namjerno ne uzima. */
      postavke(izvor) {
        const t = tablica(dokument(izvor), ['omm', 'broj brojila']);
        return t.retci
          .map((r) => ({
            omm: znamenke(t.celija(r, 'omm')),
            broj_brojila: t.celija(r, 'broj brojila'),
            korisnik: t.celija(r, 'korisnik'),
            adresa: t.celija(r, 'adresa'),
            tarifni_model: t.celija(r, 'tarifni model'),
          }))
          .filter((o) => o.omm);
      },

      /** `/Ocitanja`: stanja brojila, najnovije prvo. */
      ocitanja(izvor) {
        const t = tablica(dokument(izvor), ['datum', 'tarifa 1']);
        return t.retci
          .map((r) => ({
            datum: datum(t.celija(r, 'datum')),
            opis: t.celija(r, 'opis') || '',
            t1_kwh: broj(t.celija(r, 'tarifa 1')),
            t2_kwh: broj(t.celija(r, 'tarifa 2')),
          }))
          .filter((o) => o.datum);
      },

      /** `/Potrosnja`: potro\u0161nja po obra\u010dunskim razdobljima, najnovije prvo. */
      potrosnja(izvor) {
        const t = tablica(dokument(izvor), ['razdoblje', 'tarifa 1']);
        const re = /(\d{1,2}\.\d{1,2}\.\d{4})\.?\s*-\s*(\d{1,2}\.\d{1,2}\.\d{4})/;
        return t.retci.flatMap((r) => {
          const m = re.exec(t.celija(r, 'razdoblje') || '');
          if (!m) return [];
          const t1 = broj(t.celija(r, 'tarifa 1'));
          const t2 = broj(t.celija(r, 'tarifa 2'));
          return [{ od: datum(m[1]), do: datum(m[2]), t1_kwh: t1, t2_kwh: t2, ukupno_kwh: (t1 || 0) + (t2 || 0) }];
        });
      },

      /** OMM odabran u select#omm_select, ili null ako ga nema. */
      odabraniOmm(izvor) {
        const select = dokument(izvor).querySelector('#omm_select');
        if (!select) return null;
        const o = select.querySelector('option[selected]') || select.querySelector('option');
        return znamenke(o ? o.getAttribute('value') : null);
      },
    };
  })();

  /**
   * Uvoz svih OMM-ova prijavljene osobe s o\u010ditanjima i potro\u0161njom.
   * @param {{ocitanja?: boolean, potrosnja?: boolean, napredak?: (poruka: string) => void}} [opcije]
   */
  async function mojaMrezaUvoz({ ocitanja = true, potrosnja = true, napredak = () => {} } = {}) {
    if (location.origin !== 'https://mojamreza.hep.hr') {
      throw new MojaMrezaIznimka('mreza', 'pokreni na https://mojamreza.hep.hr');
    }

    // HTML stranice, uz provjeru da je sesija \u017eiva i da je odabran omm.
    async function stranica(putanja, omm) {
      let odgovor;
      try {
        odgovor = await fetch(omm ? `${putanja}?omm=${encodeURIComponent(omm)}` : putanja, {
          credentials: 'same-origin',
          cache: 'no-store',
        });
      } catch (e) {
        throw new MojaMrezaIznimka('mreza', String(e));
      }
      // Neprijavljen zahtjev server preusmjerava na naslovnicu.
      if (new URL(odgovor.url).pathname === '/') throw new MojaMrezaIznimka('sesijaIstekla');
      if (odgovor.status !== 200) {
        throw new MojaMrezaIznimka('mreza', `HTTP ${odgovor.status} za ${putanja}`);
      }
      const html = await odgovor.text();
      if (omm) {
        const odabran = MojaMrezaParser.odabraniOmm(html);
        if (odabran && odabran !== omm) {
          throw new MojaMrezaIznimka('neocekivanHtml', `${putanja}?omm=${omm} vratio je OMM ${odabran}`);
        }
      }
      return html;
    }

    napredak('Dohva\u0107am mjerna mjesta\u2026');
    const omms = MojaMrezaParser.postavke(await stranica('/Postavke'));
    const mjesta = [];
    for (const [i, omm] of omms.entries()) {
      napredak(`OMM ${omm.omm}${omms.length > 1 ? ` (${i + 1}/${omms.length})` : ''}\u2026`);
      mjesta.push({
        ...omm,
        ocitanja: ocitanja ? MojaMrezaParser.ocitanja(await stranica('/Ocitanja', omm.omm)) : [],
        potrosnja: potrosnja ? MojaMrezaParser.potrosnja(await stranica('/Potrosnja', omm.omm)) : [],
      });
    }
    return { izvor: 'https://mojamreza.hep.hr', dohvaceno: new Date().toISOString(), mjesta };
  }

  const izvoz = { MojaMrezaParser, MojaMrezaIznimka, mojaMrezaUvoz };
  if (typeof module !== 'undefined') module.exports = izvoz;
  else Object.assign(globalThis, izvoz);
})();

// ---- mojracun.js ----
// Uvoz s Mojeg ra\u010duna HEP Elektre (https://mojracun.hep.hr/elektra) u pregledniku.
//
// Moj ra\u010dun je Angular aplikacija s JSON API-jem na /elektra/v1/api/\u2026, pa se
// ovdje ne parsira HTML tablica nego JSON. Parser je prijepis
// lib/src/moj_racun.dart i daje isti JSON kao MojRacunUvoz.toJson().
//
// Popis kupaca sti\u017ee samo u odgovoru prijave i ostaje u memoriji aplikacije
// (nema GET rute za njega). Zato se kupacId \u010dita iz zahtjeva koje je stranica
// ve\u0107 poslala (Resource Timing), a ime, OMM i adresa iz zaglavlja \u201eKupac\u201c.
// OIB se ne uzima.
//
// Extension ubacuje datoteku u karticu i zove mojRacunUvoz(); mo\u017ee se i
// zalijepiti u konzolu prijavljene stranice.

(() => {
  class MojRacunIznimka extends Error {
    /** @param {'sesijaIstekla'|'nemaKupca'|'neocekivanOdgovor'|'mreza'} greska */
    constructor(greska, poruka) {
      super(poruka ? `${greska}: ${poruka}` : greska);
      this.greska = greska;
    }
  }

  const MojRacunParser = (() => {
    const prazno = (v) => (v == null || v === '' ? null : v);
    const tekst = (s) => (s || '').replace(/\s+/g, ' ').trim();

    // API daje `2026-10-01T01:59:00Z` (rano jutro po na\u0161em vremenu) ili
    // `\u2026+02:00`; datum je prvih 10 znakova.
    const datum = (s) => (/^\d{4}-\d{2}-\d{2}/.test(s || '') ? s.slice(0, 10) : null);

    // `dd.mm.yyyy` \u2192 `yyyy-mm-dd`.
    const hrDatum = (s) => {
      const m = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s || '');
      return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
    };

    const lista = (j, sto) => {
      if (!Array.isArray(j)) throw new MojRacunIznimka('neocekivanOdgovor', `${sto} nije lista`);
      return j;
    };

    return {
      /** `api/ocitanja/{kupacId}`: stanja brojila, najnovije prvo. */
      ocitanja: (j) =>
        lista(j, 'ocitanja')
          .map((o) => ({
            datum: datum(o.datum),
            opis: o.nacinOcitanja || '',
            t1_kwh: o.tarifa1 ?? null,
            t2_kwh: o.tarifa2 ?? null,
          }))
          .filter((o) => o.datum),

      /** `api/potrosnja/{kupacId}`: razdoblja, najnovije prvo; proizv = predano u mre\u017eu. */
      potrosnja: (j) =>
        lista(j, 'potrosnja').flatMap((p) => {
          const [od, doDatuma] = (p.razdoblje || '').split('-').map(hrDatum);
          if (!od || !doDatuma) return [];
          const t1 = p.tarifa1 ?? null;
          const t2 = p.tarifa2 ?? null;
          return [{
            od,
            do: doDatuma,
            t1_kwh: t1,
            t2_kwh: t2,
            ukupno_kwh: (t1 || 0) + (t2 || 0),
            predano_t1_kwh: p.proizv1 ?? 0,
            predano_t2_kwh: p.proizv2 ?? 0,
          }];
        }),

      /** `api/promet/{kupacId}`: ra\u010duni i uplate, najnovije prvo, i dospjeli dug. */
      promet(j) {
        if (!j || !Array.isArray(j.promet)) throw new MojRacunIznimka('neocekivanOdgovor', 'promet bez liste');
        return {
          stavke: j.promet
            .map((s) => {
              const racun = s.opis === 'Ra\u010dun';
              return {
                datum: datum(s.datum),
                opis: s.opis || '',
                duguje_eur: s.duguje ?? 0,
                potrazuje_eur: s.potrazuje ?? 0,
                // Kod uplata server ovdje vra\u0107a trenutno vrijeme, ne rok.
                dospijeva: racun ? datum(s.dospijeva) : null,
                poziv_na_broj: prazno(s.pnb),
                racun: prazno(s.racun),
                status: prazno(s.status),
              };
            })
            .filter((s) => s.datum),
          saldo: j.saldo ? { iznos_eur: j.saldo.iznos ?? null, opis: tekst(j.saldo.opis) } : null,
        };
      },

      /** Zaglavlje \u201eKupac\u201c (app-kupac-list): odabrani kupac. */
      zaglavlje(izvor) {
        const d = typeof izvor === 'string' ? new DOMParser().parseFromString(izvor, 'text/html') : izvor;
        const k = d.querySelector('app-kupac-list');
        if (!k) return null;
        const t = tekst(k.textContent);
        const naziv = k.querySelector('.ng-value-label');
        return {
          ime: naziv ? tekst(naziv.textContent) || null : null,
          ugovorni_racun: (/Ugovorni ra\u010dun:\s*(\d+)/.exec(t) || [])[1] || null,
          omm: (/Broj OMM:\s*(\d+)/.exec(t) || [])[1] || null,
          adresa: tekst((/Adresa:\s*(.+)$/.exec(t) || [])[1]) || null,
        };
      },

      /** kupacId iz URL-ova API zahtjeva, zadnje kori\u0161teni zadnji. */
      kupacIds(urlovi) {
        const ids = [];
        for (const u of urlovi) {
          const m = /\/api\/(?:promet|potrosnja|ocitanja|opomene|obracun)\/(\d+)(?:$|[?#])/.exec(u);
          if (!m) continue;
          const i = ids.indexOf(m[1]);
          if (i >= 0) ids.splice(i, 1);
          ids.push(m[1]);
        }
        return ids;
      },
    };
  })();

  /** @param {{napredak?: (poruka: string) => void}} [opcije] */
  async function mojRacunUvoz({ napredak = () => {} } = {}) {
    if (location.origin !== 'https://mojracun.hep.hr' || !location.pathname.startsWith('/elektra')) {
      throw new MojRacunIznimka('mreza', 'pokreni na https://mojracun.hep.hr/elektra');
    }
    if (location.pathname.startsWith('/elektra/login')) throw new MojRacunIznimka('sesijaIstekla');

    async function api(putanja) {
      let o;
      try {
        o = await fetch(`/elektra/v1/api/${putanja}`, { credentials: 'same-origin', cache: 'no-store' });
      } catch (e) {
        throw new MojRacunIznimka('mreza', String(e));
      }
      if (o.status === 401 || o.status === 403) throw new MojRacunIznimka('sesijaIstekla');
      if (o.status !== 200) throw new MojRacunIznimka('mreza', `HTTP ${o.status} za ${putanja}`);
      try {
        return await o.json();
      } catch {
        throw new MojRacunIznimka('neocekivanOdgovor', `${putanja} nije JSON`);
      }
    }

    const kupacIdsSada = () => MojRacunParser.kupacIds(performance.getEntriesByType('resource').map((e) => e.name));
    let ids = kupacIdsSada();
    if (ids.length === 0) {
      // Naslovnica nakon prijave jo\u0161 nije tra\u017eila ni\u0161ta s kupacId. Potro\u0161nja
      // ho\u0107e, pa se na nju prelazi Angularovim routerom, bez u\u010ditavanja
      // stranice (u\u010ditavanje bi prekinulo ovaj kod): klik na poveznicu, a bez
      // nje pushState + popstate, koji router tako\u0111er slu\u0161a.
      napredak('Otvaram Potro\u0161nju\u2026');
      const poveznica = [...document.querySelectorAll('a[href]')].find((a) => /\/potrosnja\/?$/.test(a.pathname));
      if (poveznica) poveznica.click();
      else {
        history.pushState(null, '', '/elektra/potrosnja');
        dispatchEvent(new PopStateEvent('popstate', { state: null }));
      }
      for (let i = 0; i < 40 && ids.length === 0; i++) {
        await new Promise((ok) => setTimeout(ok, 250));
        ids = kupacIdsSada();
      }
      // Zaglavlje \u201eKupac\u201c se iscrta tek nakon odgovora.
      await new Promise((ok) => setTimeout(ok, 600));
    }
    if (ids.length === 0) throw new MojRacunIznimka('nemaKupca');
    // Zaglavlje pokazuje kupca \u010diji su podaci zadnji u\u010ditani.
    const odabran = ids[ids.length - 1];
    const zaglavlje = MojRacunParser.zaglavlje(document);

    const kupci = [];
    for (const [i, id] of ids.entries()) {
      napredak(`Kupac ${id}${ids.length > 1 ? ` (${i + 1}/${ids.length})` : ''}\u2026`);
      const promet = MojRacunParser.promet(await api(`promet/${id}`));
      kupci.push({
        kupac_id: id,
        ...(id === odabran && zaglavlje ? zaglavlje : { ime: null, ugovorni_racun: null, omm: null, adresa: null }),
        saldo: promet.saldo,
        ocitanja: MojRacunParser.ocitanja(await api(`ocitanja/${id}`)),
        potrosnja: MojRacunParser.potrosnja(await api(`potrosnja/${id}`)),
        promet: promet.stavke,
      });
    }
    return { izvor: 'https://mojracun.hep.hr', dohvaceno: new Date().toISOString(), kupci };
  }

  const izvoz = { MojRacunParser, MojRacunIznimka, mojRacunUvoz };
  if (typeof module !== 'undefined') module.exports = izvoz;
  else Object.assign(globalThis, izvoz);
})();

// ---- hepi.js ----
// Uvoz s Mojeg Hepi ra\u010duna (https://mojracun.hep.hr/hepi), portala HEP Opskrbe
// za kupce na tr\u017ei\u0161tu. Zaseban od Mojeg ra\u010duna HEP Elektre (/elektra), sa
// zasebnom prijavom.
//
// Hepi je AngularJS aplikacija s JSON API-jem na /hepi/api/\u2026. Prijava sprema
// token u localStorage['hepi.token'] i stranica ga \u0161alje kao Bearer; ovaj kod
// radi isto, ali token nikad ne napu\u0161ta stranicu. Za razliku od Elektre
// postoji GET /api/kupci, pa ne treba Resource Timing, a /api/report/racun
// vra\u0107a PDF ra\u010duna. OIB i mail se ne uzimaju.
//
// Bookmarklet ubacuje datoteku u karticu i zove hepiUvoz(); mo\u017ee se i
// zalijepiti u konzolu prijavljene stranice.

(() => {
  class HepiIznimka extends Error {
    /** @param {'sesijaIstekla'|'neocekivanOdgovor'|'mreza'} greska */
    constructor(greska, poruka) {
      super(poruka ? `${greska}: ${poruka}` : greska);
      this.greska = greska;
    }
  }

  const HepiParser = (() => {
    const prazno = (v) => (v == null || v === '' ? null : v);
    // API daje `2026-09-30T02:00:00+02:00` (pono\u0107 po na\u0161em vremenu); datum je prvih 10 znakova.
    const datum = (s) => (/^\d{4}-\d{2}-\d{2}/.test(s || '') && !String(s).startsWith('0001') ? s.slice(0, 10) : null);
    // `01.09.2026-30.09.2026` \u2192 { od, do }.
    const razdoblje = (s) => {
      const m = /(\d{2})\.(\d{2})\.(\d{4})\s*-\s*(\d{2})\.(\d{2})\.(\d{4})/.exec(s || '');
      return m ? { od: `${m[3]}-${m[2]}-${m[1]}`, do: `${m[6]}-${m[5]}-${m[4]}` } : { od: null, do: null };
    };
    const lista = (j, sto) => {
      if (!Array.isArray(j)) throw new HepiIznimka('neocekivanOdgovor', `${sto} nije lista`);
      return j;
    };

    /** GET /api/kupci: objekt { kupacId: kupac }. */
    function kupci(j) {
      if (!j || typeof j !== 'object') throw new HepiIznimka('neocekivanOdgovor', 'kupci nisu objekt');
      return Object.values(j).map((k) => ({
        kupac_id: String(k.KupacId),
        sifra_kupca: prazno(k.Sifra),
        ime: prazno(k.Naziv),
        omm: prazno(k.Omm),
        adresa: prazno(k.AdresaOmm) || prazno(k.Adresa),
        tarifni_model: prazno(k.TarifniModel),
        ugovor_od: datum(k.UgovorOd),
      }));
    }

    /** GET /api/potrosnja/:kupacId: { Total, Potrosnja[], Ocitanja[] }, najnovije prvo. */
    function potrosnja(j) {
      return {
        potrosnja: lista(j && j.Potrosnja, 'Potrosnja').map((p) => ({
          ...razdoblje(p.Razdoblje),
          t1_kwh: p.Tarifa1,
          t2_kwh: p.Tarifa2,
          ukupno_kwh: p.Ukupno,
        })),
        ocitanja: lista(j && j.Ocitanja, 'Ocitanja').map((o) => ({
          datum: datum(o.Datum),
          opis: prazno(o.NacinOcitanja),
          t1_kwh: o.Tarifa1,
          t2_kwh: o.Tarifa2,
        })),
      };
    }

    /** GET /api/promet/:kupacId: { Total (saldo), Racuni[], Uplate[] }. */
    function promet(j) {
      const t = (j && j.Total) || {};
      return {
        saldo: { iznos_eur: typeof t.Iznos === 'number' ? t.Iznos : null, opis: prazno(t.Labela) },
        racuni: lista(j && j.Racuni, 'Racuni').map((r) => ({
          datum: datum(r.Datum),
          poziv_na_broj: prazno(r.Pnb),
          iznos_eur: r.Iznos,
          dospijeva: datum(r.Dospijeva),
          placen: r.Status === 1,
          status: prazno(r.StatusText),
          link: prazno(r.Link),
        })),
        uplate: lista(j && j.Uplate, 'Uplate').map((u) => ({ datum: datum(u.Datum), iznos_eur: u.Iznos })),
      };
    }

    return { kupci, potrosnja, promet };
  })();

  function token() {
    let t = null;
    try { t = localStorage.getItem('hepi.token'); } catch {}
    if (!t || t === 'undefined') throw new HepiIznimka('sesijaIstekla');
    return t;
  }

  async function zahtjev(putanja, opcije = {}) {
    let o;
    try {
      o = await fetch(`/hepi/api/${putanja}`, {
        cache: 'no-store',
        ...opcije,
        headers: { Authorization: `Bearer ${token()}`, ...(opcije.headers || {}) },
      });
    } catch (e) {
      throw new HepiIznimka('mreza', String(e));
    }
    if (o.status === 401 || o.status === 403) throw new HepiIznimka('sesijaIstekla');
    if (o.status !== 200) throw new HepiIznimka('mreza', `HTTP ${o.status} za ${putanja}`);
    return o;
  }

  async function api(putanja) {
    const o = await zahtjev(putanja);
    try {
      return await o.json();
    } catch {
      throw new HepiIznimka('neocekivanOdgovor', `${putanja} nije JSON`);
    }
  }

  /** PDF ra\u010duna (`link` iz promet.racuni[]), kao gumb za ispis ra\u010duna na portalu. */
  async function hepiRacunPdf(link) {
    const o = await zahtjev('report/racun', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ link }),
    });
    const b = new Uint8Array(await o.arrayBuffer());
    // Server \u0161alje Content-Type text/html, pa se provjerava zaglavlje datoteke.
    if (String.fromCharCode(...b.slice(0, 5)) !== '%PDF-') throw new HepiIznimka('neocekivanOdgovor', 'ra\u010dun nije PDF');
    return b;
  }

  /** @param {{napredak?: (poruka: string) => void}} [opcije] */
  async function hepiUvoz({ napredak = () => {} } = {}) {
    if (location.origin !== 'https://mojracun.hep.hr' || !location.pathname.startsWith('/hepi')) {
      throw new HepiIznimka('mreza', 'pokreni na https://mojracun.hep.hr/hepi');
    }
    napredak('Dohva\u0107am kupce\u2026');
    const popis = HepiParser.kupci(await api('kupci'));
    const kupci = [];
    for (const [i, k] of popis.entries()) {
      napredak(`Kupac ${k.sifra_kupca || k.kupac_id}${popis.length > 1 ? ` (${i + 1}/${popis.length})` : ''}\u2026`);
      const { saldo, racuni, uplate } = HepiParser.promet(await api(`promet/${k.kupac_id}`));
      const { potrosnja, ocitanja } = HepiParser.potrosnja(await api(`potrosnja/${k.kupac_id}`));
      kupci.push({ ...k, saldo, ocitanja, potrosnja, racuni, uplate });
    }
    return { izvor: 'https://mojracun.hep.hr/hepi', dohvaceno: new Date().toISOString(), kupci };
  }

  const izvoz = { HepiParser, HepiIznimka, hepiUvoz, hepiRacunPdf };
  if (typeof module !== 'undefined') module.exports = izvoz;
  else Object.assign(globalThis, izvoz);
})();

// ---- bookmarklet.js ----
// Bookmarklet \u201eUvezi iz HEP-a\u201c: isti uvoz kao extension, bez instalacije.
//
// Oznaka u pregledniku ubacuje <script src="https://omm.domovina.ai/hep-uvoz.js?k=<klju\u010d>">
// u prijavljenu karticu Moje mre\u017ee, Mojeg ra\u010duna (Elektra) ili Mojeg Hepi
// ra\u010duna. Ta datoteka je spoj uvoz.js + mojracun.js + hepi.js + ove datoteke
// (tools/bookmarklet.mjs), pa se kod
// izvr\u0161ava na HEP-ovoj domeni: fetch je same-origin s cookiejima sesije, kao u
// extensionu. Na omm.domovina.ai odlazi samo gotov JSON, i to tek na klik.
//
// Prikaz je fiksni desni stupac (shadow DOM) u izgledu omm.domovina.ai (znak B):
// prvo ka\u017ee \u0161to \u010dita, \u0161to \u0161alje i \u0161to ne dira, nakon \u010ditanja poka\u017ee sa\u017eetak i
// cijeli JSON, a \u0161alje tek na drugi klik.
//
// Za\u0161to radi: nijedan portal nema CSP koji ograni\u010dava script-src ili
// connect-src (provjereno 2026-10-14), a /api/snimak ima CORS *. Ako se to
// promijeni, rezerva je nova kartica omm.domovina.ai/?primi=1 i postMessage.

(() => {
  const skripta = document.currentScript;
  const adresa = new URL(skripta ? skripta.src : 'https://omm.domovina.ai/hep-uvoz.js');
  const SERVER = adresa.origin;
  const HOST = SERVER.replace('https://', '');
  const KLJUC = adresa.searchParams.get('k');

  // Elektra i Hepi dijele origin mojracun.hep.hr, pa se razlikuju po putanji.
  // `zahtjevi` su to\u010dno oni koje uvoz \u0161alje portalu (docs/kako-citamo-podatke.md).
  const IZVORI = [
    { adresa: 'https://mojamreza.hep.hr/', ime: 'Moja mre\u017ea (HEP ODS)', funkcija: 'mojaMrezaUvoz', ommIzvor: 'hep', datoteka: 'moja-mreza',
      cita: ['mjerna mjesta: broj OMM-a i brojila, adresa, tarifni model', 'o\u010ditanja brojila: datum, T1 i T2 u kWh', 'potro\u0161nju po obra\u010dunskim razdobljima'],
      zahtjevi: ['GET /Postavke', 'GET /Ocitanja?omm=\u2026', 'GET /Potrosnja?omm=\u2026'] },
    { adresa: 'https://mojracun.hep.hr/elektra', ime: 'Moj ra\u010dun (HEP Elektra)', funkcija: 'mojRacunUvoz', ommIzvor: 'hep-moj-racun', datoteka: 'moj-racun',
      cita: ['kupca iz zaglavlja stranice: ime, ugovorni ra\u010dun, OMM, adresa', 'o\u010ditanja i potro\u0161nju po razdobljima', 'promet: ra\u010dune, uplate i saldo'],
      zahtjevi: ['GET /elektra/v1/api/ocitanja/{kupac}', 'GET /elektra/v1/api/potrosnja/{kupac}', 'GET /elektra/v1/api/promet/{kupac}'] },
    { adresa: 'https://mojracun.hep.hr/hepi', ime: 'Moj Hepi ra\u010dun (HEP Opskrba)', funkcija: 'hepiUvoz', ommIzvor: 'hep-hepi', datoteka: 'hepi',
      cita: ['kupca: OMM, adresa, tarifni model', 'saldo, ra\u010dune i uplate', 'potro\u0161nju i o\u010ditanja', 'PDF-ove ra\u010duna koje omm.domovina.ai jo\u0161 nema'],
      zahtjevi: ['GET /hepi/api/kupci', 'GET /hepi/api/promet/{kupac}', 'GET /hepi/api/potrosnja/{kupac}', 'POST /hepi/api/report/racun (PDF ra\u010duna, kao gumb Ispis)'],
      racuni: true },
  ];
  const PORUKE = {
    sesijaIstekla: 'Nisi prijavljen. Prijavi se na ovoj stranici pa klikni oznaku ponovno.',
    neocekivanHtml: 'Stranica ne izgleda kako uvoz o\u010dekuje (HEP ju je mo\u017eda promijenio).',
    neocekivanOdgovor: 'Odgovor Mojeg ra\u010duna ne izgleda kako uvoz o\u010dekuje (HEP ga je mo\u017eda promijenio).',
    nemaKupca: 'Ne vidim kupca. Otvori Potro\u0161nju ili Promet u Mojem ra\u010dunu pa klikni oznaku ponovno.',
    mreza: 'Mre\u017ea ili preglednik javili su gre\u0161ku.',
  };

  // Klik na oznaku na samom omm.domovina.ai je provjera da je oznaka u traci:
  // naslovnica slu\u0161a ovaj doga\u0111aj, potvrdi i zapamti. Stupac se ne otvara.
  if (location.origin === SERVER) {
    window.dispatchEvent(new CustomEvent('omm-oznaka', { detail: { kljuc: KLJUC } }));
    return;
  }

  // Na \u0161irokom zaslonu stupac odmakne stranicu ulijevo (margin na <html>), pa
  // ne prekriva portal; na uskom le\u017ei preko nje. Fiksna zaglavlja portala se
  // ne pomi\u010du, ali HEP-ovi portali ih nemaju desno.
  const SIRINA = 400;
  const odmakni = (da) => {
    const h = document.documentElement.style;
    if (da && innerWidth >= SIRINA + 640) h.setProperty('margin-right', `${SIRINA}px`, 'important');
    else h.removeProperty('margin-right');
  };

  // Drugi klik na oznaku samo vrati postoje\u0107i stupac.
  const postojeci = document.getElementById('omm-domovina-uvoz');
  if (postojeci) {
    postojeci.style.display = '';
    odmakni(true);
    return;
  }

  const domacin = document.createElement('div');
  domacin.id = 'omm-domovina-uvoz';
  domacin.style.cssText = 'position:fixed;top:0;right:0;bottom:0;z-index:2147483647;';
  // Shadow DOM: HEP-ov CSS ne dira stupac i obrnuto.
  const korijen = domacin.attachShadow({ mode: 'closed' });
  // Tokeni i znak (plo\u010dica B) su s omm.domovina.ai (src/components/Tema.astro,
  // public/logo.svg i logo-noc.svg). Tema prati sustav: prekida\u010d s na\u0161eg
  // origina ovdje ne vidimo.
  korijen.innerHTML = `
    <style>
      :host { all: initial; }
      .s { --bg: #f5f7fb; --kartica: #fff; --tekst: #0e1a2e; --blijedo: #55617a; --rub: #dde3ee;
        --akcent: #002F6C; --akcent-tekst: #fff; --akcent-blago: #e6ecf5; --greska: #b3261e; --greska-bg: #fdf2f2;
        --uspjeh: #196931; --uspjeh-bg: #eaf6ee; --plocica: #002F6C; --prsten: #fff;
        width: min(${SIRINA}px, 100vw); height: 100%; box-sizing: border-box; display: flex; flex-direction: column;
        background: var(--bg); color: var(--tekst); border-left: 1px solid var(--rub); box-shadow: -8px 0 32px rgba(0,0,0,.14);
        font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color-scheme: light; }
      @media (prefers-color-scheme: dark) {
        .s { --bg: #001a3d; --kartica: #002452; --tekst: #eef2f8; --blijedo: #9fb0c9; --rub: #1d3a66;
          --akcent: #E3AF35; --akcent-tekst: #001a3d; --akcent-blago: #0d2d58; --greska: #ff8a80; --greska-bg: #321616;
          --uspjeh: #6dd489; --uspjeh-bg: #12281a; --plocica: #fff; --prsten: #002F6C; color-scheme: dark; }
      }
      * { box-sizing: border-box; }
      header { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--rub); background: var(--kartica); }
      header svg { width: 32px; height: 32px; flex: none; }
      .marka { flex: 1; font-size: 15px; letter-spacing: .02em; }
      .marka b { font-weight: 800; } .marka span { color: var(--blijedo); font-weight: 500; }
      .tijelo { flex: 1; overflow-y: auto; padding: 16px; }
      .podnozje { padding: 12px 16px 16px; border-top: 1px solid var(--rub); background: var(--kartica); }
      h2 { font-size: 17px; line-height: 1.3; margin: 0 0 4px; }
      h3 { font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--blijedo); margin: 0 0 6px; }
      p, ul { margin: 8px 0; } ul { padding-left: 18px; } li { margin: 2px 0; }
      .kartica { background: var(--kartica); border: 1px solid var(--rub); border-radius: 12px; padding: 12px 14px; margin: 12px 0; }
      .kartica > :last-child { margin-bottom: 0; }
      .blijedo { color: var(--blijedo); font-size: 13px; }
      code, pre { font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
      .zahtjevi { list-style: none; padding: 0; margin: 8px 0 0; }
      .zahtjevi li { padding: 3px 8px; margin: 3px 0; background: var(--akcent-blago); border-radius: 6px; overflow-wrap: anywhere; }
      .ne li::marker { content: "\u2715  "; color: var(--blijedo); }
      details { margin-top: 10px; } summary { cursor: pointer; font-weight: 600; color: var(--akcent); }
      pre { max-height: 320px; overflow: auto; margin: 8px 0 0; padding: 10px; background: var(--akcent-blago); border-radius: 8px; white-space: pre; }
      button { display: block; width: 100%; min-height: 44px; margin-top: 8px; padding: 0 14px; border: 0; border-radius: 10px;
        font: inherit; font-weight: 600; cursor: pointer; background: var(--akcent); color: var(--akcent-tekst); }
      button:first-child { margin-top: 0; }
      button.sporedni { background: transparent; color: var(--tekst); border: 1px solid var(--rub); }
      button:disabled { opacity: .5; cursor: default; }
      button.x { width: 32px; min-height: 32px; margin: 0; padding: 0; background: transparent; color: var(--blijedo); font-size: 22px; line-height: 1; }
      .status { margin: 0 0 10px; font-size: 13px; color: var(--blijedo); }
      .greska { color: var(--greska); } .greska.kartica { background: var(--greska-bg); border-color: transparent; }
      .uspjeh { background: var(--uspjeh-bg); color: var(--uspjeh); border-color: transparent; font-weight: 600; }
      a { color: var(--akcent); }
      [hidden] { display: none !important; }
    </style>
    <aside class="s" role="complementary" aria-label="Uvoz na ${HOST}">
      <header>
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="8" fill="var(--plocica)"/>
          <path d="M6 16A10 10 0 1 0 26 16A10 10 0 1 0 6 16ZM9 16A7 7 0 1 1 23 16A7 7 0 1 1 9 16Z" fill="var(--prsten)" fill-rule="evenodd"/>
          <path d="M17.94 10.53 L12.76 15.71 L15.64 15.71 L14.06 21.47 L19.24 16.29 L16.36 16.29Z" fill="#E3AF35"/>
        </svg>
        <div class="marka"><b>OMM</b> <span>uvoz s HEP-a</span></div>
        <button class="x" id="zatvori" title="Zatvori" aria-label="Zatvori">\u00d7</button>
      </header>
      <div class="tijelo" id="sadrzaj"></div>
      <div class="podnozje" id="podnozje" hidden>
        <p id="status" class="status" hidden></p>
        <div id="gumbi"></div>
      </div>
    </aside>`;
  document.body.append(domacin);
  odmakni(true);
  const $ = (id) => korijen.getElementById(id);
  $('zatvori').onclick = () => {
    domacin.style.display = 'none';
    odmakni(false);
  };

  const status = (tekst, greska = false) => {
    $('status').hidden = !tekst;
    $('status').textContent = tekst || '';
    $('status').className = greska ? 'status greska' : 'status';
  };
  const gumb = (tekst, klik, sporedni = false) => {
    const b = document.createElement('button');
    b.textContent = tekst;
    if (sporedni) b.className = 'sporedni';
    b.onclick = klik;
    return b;
  };
  // Gumbi stoje u podno\u017eju stupca, uvijek vidljivi; svaki korak ih zamijeni.
  const gumbi = (...lista) => {
    $('podnozje').hidden = false;
    $('gumbi').replaceChildren(...lista);
  };
  const el = (oznaka, html, klasa) => {
    const e = document.createElement(oznaka);
    if (html != null) e.innerHTML = html;
    if (klasa) e.className = klasa;
    return e;
  };
  const lista = (stavke, klasa) => {
    const ul = el('ul', null, klasa);
    for (const s of stavke) {
      const li = document.createElement('li');
      li.textContent = s;
      ul.append(li);
    }
    return ul;
  };
  const kartica = (naslov, ...djeca) => {
    const k = el('section', null, 'kartica');
    if (naslov) k.append(el('h3', naslov));
    k.append(...djeca);
    return k;
  };

  const izvor = IZVORI.find((i) => location.href.startsWith(i.adresa));
  const sadrzaj = $('sadrzaj');

  if (!KLJUC || !/^[A-Za-z0-9_-]{22,64}$/.test(KLJUC)) {
    sadrzaj.append(el('p', `Oznaka nema klju\u010d. Napravi je ponovno na <a href="${SERVER}/" target="_blank">${HOST}</a>.`, 'greska kartica'));
    return;
  }
  if (!izvor) {
    sadrzaj.append(
      el('h2', 'Ovo nije HEP-ov portal'),
      el('p', 'Oznaka radi samo na HEP-ovim portalima. Otvori jedan, prijavi se i klikni oznaku ponovno.'),
    );
    gumbi(
      gumb('Otvori Moju mre\u017eu (HEP ODS)', () => { location.href = 'https://mojamreza.hep.hr/'; }),
      gumb('Otvori Moj ra\u010dun (HEP Elektra)', () => { location.href = 'https://mojracun.hep.hr/elektra/'; }, true),
      gumb('Otvori Moj Hepi ra\u010dun (HEP Opskrba)', () => { location.href = 'https://mojracun.hep.hr/hepi/'; }, true),
    );
    return;
  }

  // Korak 1: prije i\u010dega re\u0107i \u0161to \u0107e se dogoditi.
  sadrzaj.append(
    el('h2', `Uvoz s portala ${izvor.ime}`),
    el('p', `Ovaj stupac je dodala tvoja oznaka s <b>${HOST}</b>. Dok ne klikne\u0161 gumb dolje, nije pro\u010ditao ni poslao ni\u0161ta.`, 'blijedo'),
    kartica('1. \u0160to \u010ditamo s ove stranice',
      el('p', 'Iz tvoje prijavljene sesije, isto \u0161to vidi\u0161 kad klika\u0161 po portalu:'),
      lista(izvor.cita),
      el('p', 'Zahtjevi koje \u0161aljemo portalu:', 'blijedo'),
      lista(izvor.zahtjevi, 'zahtjevi'),
    ),
    kartica('2. \u0160to \u0161aljemo na omm.domovina.ai',
      el('p', `Samo pro\u010ditane podatke kao JSON, na <code>${HOST}/api/snimak</code>. Prije slanja ih vidi\u0161 ovdje i tek onda klikne\u0161 <b>Po\u0161alji</b>.`),
      ...(izvor.racuni
        ? [el('p', `PDF-ove ra\u010duna \u0161aljemo na <code>${HOST}/api/racun</code>: server iz njih pro\u010dita iznose i stavke, a PDF ne \u010duva.`)]
        : []),
      el('p', 'Uz podatke ide samo klju\u010d ove oznake, po kojem ih poslije vidi\u0161 pod \u201eMoji uvozi\u201c. Ni ime ni mail ne trebaju.', 'blijedo'),
    ),
    kartica('3. \u0160to ne diramo',
      lista([
        'OIB i lozinku',
        izvor.racuni ? 'token prijave: koristimo ga samo na ovoj stranici, ne \u0161aljemo ga nikamo' : 'kola\u010di\u0107e i prijavu: ostaju u ovom pregledniku',
        'ni\u0161ta ne mijenjamo na portalu: nema predaje o\u010ditanja ni promjene podataka',
      ], 'ne'),
    ),
    el('p', `Kod koji se upravo izvr\u0161ava: <a href="${SERVER}/hep-uvoz.js" target="_blank" rel="noopener">${HOST}/hep-uvoz.js</a>. ` +
      'Popis svih zahtjeva: <a href="https://github.com/stepanic/flutter_moja_mreza/blob/main/docs/kako-citamo-podatke.md" target="_blank" rel="noopener">kako \u010ditamo podatke</a>.', 'blijedo'),
  );
  const procitaj = gumb('Pro\u010ditaj podatke', pokreni);
  gumbi(procitaj);

  // OMM snimka kad uvoz ima to\u010dno jedno mjesto (Moja mre\u017ea) ili kupca (Moj ra\u010dun).
  const jediniOmm = (u) => {
    const lista = u.mjesta || u.kupci || [];
    return lista.length === 1 ? lista[0].omm || null : null;
  };

  const sazetak = (u) =>
    (u.mjesta || u.kupci || []).map((m) =>
      `${m.omm || `kupac ${m.kupac_id}`}${m.adresa ? `, ${m.adresa}` : ''}: ${m.ocitanja.length} o\u010ditanja, ${m.potrosnja.length} razdoblja potro\u0161nje` +
      (m.promet ? `, ${m.promet.length} stavki prometa` : '') +
      (m.racuni ? `, ${m.racuni.length} ra\u010duna` : ''));

  const tijelo = (u) => ({ izvor: izvor.ommIzvor, omm: jediniOmm(u), uvoz: u, lokacija: null });

  // Korak 2: \u010ditanje, pa pregled svega \u0161to bi oti\u0161lo.
  async function pokreni() {
    procitaj.disabled = true;
    status('\u010citam\u2026');
    let uvoz;
    try {
      uvoz = await globalThis[izvor.funkcija]({ napredak: status });
    } catch (e) {
      status(`${PORUKE[e.greska] || PORUKE.mreza} (${e.message || e})`, true);
      procitaj.disabled = false;
      procitaj.textContent = 'Poku\u0161aj ponovno';
      return;
    }
    status('');
    const stavke = sazetak(uvoz);
    const json = el('pre');
    json.textContent = JSON.stringify(tijelo(uvoz), null, 2);
    const detalji = el('details');
    detalji.append(el('summary', `Pogledaj to\u010dno \u0161to \u0161aljemo (${Math.max(1, Math.round(json.textContent.length / 1024))} kB JSON)`), json);
    const pregled = kartica('Pro\u010ditano, jo\u0161 ni\u0161ta nije poslano',
      stavke.length ? lista(stavke) : el('p', 'Nema mjernih mjesta na ovom ra\u010dunu.'),
      el('p', izvor.racuni
        ? `Klikom na Po\u0161alji ovo ide na ${HOST}, a zatim PDF-ovi ra\u010duna koje ondje jo\u0161 nemamo.`
        : `Klikom na Po\u0161alji ovo ide na ${HOST}.`, 'blijedo'),
      detalji,
    );
    sadrzaj.append(pregled);
    pregled.scrollIntoView({ behavior: 'smooth', block: 'start' });
    gumbi(
      gumb(`Po\u0161alji na ${HOST}`, () => posalji(uvoz)),
      gumb('Samo preuzmi JSON', () => preuzmi(uvoz), true),
    );
  }

  async function posalji(uvoz) {
    for (const b of $('gumbi').querySelectorAll('button')) b.disabled = true;
    status(`\u0160aljem na ${HOST}\u2026`);
    try {
      const o = await fetch(`${SERVER}/api/snimak`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KLJUC}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(tijelo(uvoz)),
        credentials: 'omit',
      });
      const j = await o.json().catch(() => ({}));
      if (o.status !== 200 && o.status !== 201) throw new Error(j.greska || `HTTP ${o.status}`);
      const poruka = j.duplikat ? `Isti uvoz je ve\u0107 bio na ${HOST} \u2713` : `Spremljeno na ${HOST} \u2713`;
      if (izvor.racuni) await posaljiRacune(uvoz);
      gotovo(poruka);
    } catch (e) {
      status(`Izravno slanje nije uspjelo (${e.message || e}).`, true);
      rezerva(uvoz);
    }
  }

  // Hepi: PDF-ove ra\u010duna koje server jo\u0161 nema \u0161alje na /api/racun, gdje se
  // pro\u010ditaju (isti parser kao za ra\u010dune mailom) i odbace. Server vra\u0107a popis
  // poziva na broj koje ve\u0107 ima, pa se ponovni uvoz svodi na nove ra\u010dune.
  async function posaljiRacune(uvoz) {
    const auth = { Authorization: `Bearer ${KLJUC}` };
    let imamo = [];
    try {
      const o = await fetch(`${SERVER}/api/racun`, { headers: auth, credentials: 'omit' });
      if (o.ok) imamo = await o.json();
    } catch {}
    const novi = uvoz.kupci.flatMap((k) => k.racuni).filter((r) => r.link && r.poziv_na_broj && !imamo.includes(r.poziv_na_broj));
    let procitano = 0;
    for (const [i, r] of novi.entries()) {
      status(`Ra\u010dun ${i + 1}/${novi.length}\u2026`);
      try {
        const pdf = await globalThis.hepiRacunPdf(r.link);
        const o = await fetch(`${SERVER}/api/racun`, {
          method: 'POST', headers: { ...auth, 'Content-Type': 'application/pdf' }, body: pdf, credentials: 'omit',
        });
        if (o.ok) procitano++;
      } catch {}
    }
    if (novi.length) {
      sadrzaj.append(el('p', `Pro\u010ditano ${procitano} od ${novi.length} novih ra\u010duna.`, procitano === novi.length ? 'blijedo' : 'greska'));
    }
  }

  function gotovo(poruka) {
    status('');
    const k = el('p', poruka, 'kartica uspjeh');
    sadrzaj.append(k);
    k.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    gumbi(
      // ?k= prenosi klju\u010d oznake: stranica ga preuzme i poka\u017ee uvoze i kad je
      // oznaka napravljena u drugom pregledniku ili profilu.
      gumb(`Otvori ${HOST}`, () => window.open(`${SERVER}/?k=${encodeURIComponent(KLJUC)}`, '_blank')),
      gumb('Zatvori', () => $('zatvori').click(), true),
    );
  }

  function preuzmi(uvoz) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(uvoz, null, 2)], { type: 'application/json' }));
    a.download = `${izvor.datoteka}-${uvoz.dohvaceno.slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // Ako HEP jednom uvede CSP ili WAF koji prije\u010di fetch prema nama: nova
  // kartica omm.domovina.ai/?primi=1 javi \u201espreman\u201c, dobije JSON preko
  // postMessage (provjerava event.origin) i sama ga spremi.
  function rezerva(uvoz) {
    gumbi(
      gumb('Po\u0161alji preko nove kartice', () => {
        const prozor = window.open(`${SERVER}/?primi=1`, '_blank');
        if (!prozor) return status('Preglednik je blokirao novu karticu.', true);
        const slusaj = (e) => {
          if (e.origin !== SERVER || e.source !== prozor || !e.data || e.data.omm !== 'spreman') return;
          window.removeEventListener('message', slusaj);
          prozor.postMessage({ omm: 'uvoz', tijelo: tijelo(uvoz) }, SERVER);
          gotovo(`Poslano u novu karticu ${HOST}`);
        };
        window.addEventListener('message', slusaj);
      }),
      gumb('Preuzmi JSON', () => preuzmi(uvoz), true),
    );
  }
})();
