import { RATE, W, after, big, blocks, clip, decode, enc, fixed, fmt, inner, json, madridDay, madridHour, madridStamp, need, number, placeOf, weekday, type Connector, type Ctx, type Params } from "@/lib/data-helpers";

// Fuentes GRATUITAS y SIN CLAVE con datos en tiempo real. Cada una declara las direcciones que puede llamar (lista cerrada),
// cuándo se activa desde el chat (solo frases claras), y cómo resume la respuesta para que la IA local la cite.
// Los formatos están tomados de la documentación de cada servicio; el botón «Probar» comprueba que sigue funcionando en tu equipo.

const WMO: Record<number, string> = { 0: "despejado", 1: "mayormente despejado", 2: "parcialmente nublado", 3: "nublado", 45: "niebla", 48: "niebla con escarcha", 51: "llovizna débil", 53: "llovizna", 55: "llovizna intensa", 56: "llovizna helada", 57: "llovizna helada intensa", 61: "lluvia débil", 63: "lluvia", 65: "lluvia fuerte", 66: "lluvia helada", 67: "lluvia helada fuerte", 71: "nieve débil", 73: "nieve", 75: "nieve fuerte", 77: "granos de nieve", 80: "chubascos débiles", 81: "chubascos", 82: "chubascos fuertes", 85: "chubascos de nieve", 86: "chubascos de nieve fuertes", 95: "tormenta", 96: "tormenta con granizo", 99: "tormenta con granizo fuerte" };
const sky = (code: number): string => WMO[code] ?? `código ${code}`;
const hour = (iso: string): string => iso.slice(11, 16);

async function place(name: string, get: Ctx["get"]): Promise<{ latitude: number; longitude: number; name: string; admin1?: string; country?: string }> {
  const data = json<{ results?: Array<{ latitude: number; longitude: number; name: string; admin1?: string; country?: string }> }>(await get(`https://geocoding-api.open-meteo.com/v1/search?name=${enc(name)}&count=1&language=es&format=json`), "El buscador de lugares");
  const hit = data.results?.[0];
  if (!hit) throw new Error(`No encuentro el lugar «${name}». Prueba con el nombre de otra forma.`);
  return hit;
}
const placeName = (p: { name: string; admin1?: string; country?: string }): string => [p.name, p.admin1 && p.admin1 !== p.name ? p.admin1 : "", p.country ? `(${p.country})` : ""].filter(Boolean).join(", ").replace(", (", " (");

// ------------------------------------------------------------------------------------------------ divisas y criptos
const CURRENCIES: Array<[RegExp, string]> = [
  [/\b(?:euros?|eur)\b|€/i, "EUR"], [/\b(?:d[oó]lar(?:es)?(?: estadounidenses?)?|usd)\b|\$/i, "USD"], [/\b(?:libras?(?: esterlinas?)?|gbp)\b|£/i, "GBP"], [/\b(?:yenes?|jpy)\b|¥/i, "JPY"],
  [/\b(?:francos? suizos?|chf)\b/i, "CHF"], [/\b(?:yuanes?|yuan|cny|renminbi)\b/i, "CNY"], [/\b(?:pesos? mexicanos?|mxn)\b/i, "MXN"], [/\b(?:pesos? argentinos?|ars)\b/i, "ARS"],
  [/\b(?:reales? brasile[ñn]os?|brl)\b/i, "BRL"], [/\b(?:d[oó]lares? canadienses?|cad)\b/i, "CAD"], [/\b(?:d[oó]lares? australianos?|aud)\b/i, "AUD"], [/\b(?:coronas? suecas?|sek)\b/i, "SEK"],
  [/\b(?:pesos? colombianos?|cop)\b/i, "COP"], [/\b(?:pesos? chilenos?|clp)\b/i, "CLP"], [/\b(?:soles?|pen)\b/i, "PEN"], [/\b(?:rupias? indias?|inr)\b/i, "INR"], [/\b(?:liras? turcas?|try)\b/i, "TRY"], [/\b(?:zlotys?|pln)\b/i, "PLN"],
];
const CODE = /^[A-Z]{3}$/;

const COINS: Array<[RegExp, string, string]> = [
  [/\b(?:bitcoin|btc)\b/i, "bitcoin", "Bitcoin"], [/\b(?:ethereum|ether|eth)\b/i, "ethereum", "Ethereum"], [/\b(?:solana|sol)\b/i, "solana", "Solana"], [/\b(?:xrp|ripple)\b/i, "ripple", "XRP"],
  [/\b(?:dogecoin|doge)\b/i, "dogecoin", "Dogecoin"], [/\b(?:cardano|ada)\b/i, "cardano", "Cardano"], [/\b(?:litecoin|ltc)\b/i, "litecoin", "Litecoin"], [/\b(?:tether|usdt)\b/i, "tether", "Tether"],
  [/\bbnb\b/i, "binancecoin", "BNB"], [/\bpolkadot\b/i, "polkadot", "Polkadot"], [/\bavalanche\b/i, "avalanche-2", "Avalanche"], [/\bchainlink\b/i, "chainlink", "Chainlink"], [/\bmonero\b/i, "monero", "Monero"], [/\btron\b/i, "tron", "TRON"], [/\bshiba\b/i, "shiba-inu", "Shiba Inu"],
];
const PRICE_WORDS = /\b(?:precio|cotiza(?:ci[oó]n)?|vale|valor|cu[aá]nto|a cu[aá]nto|est[aá]|cuesta)\b/i;

const STOCKS: Array<[RegExp, string, string]> = [
  [/\bapple\b|\baapl\b/i, "aapl.us", "Apple"], [/\bmicrosoft\b|\bmsft\b/i, "msft.us", "Microsoft"], [/\btesla\b|\btsla\b/i, "tsla.us", "Tesla"], [/\b(?:google|alphabet|googl)\b/i, "googl.us", "Alphabet (Google)"],
  [/\bamazon\b|\bamzn\b/i, "amzn.us", "Amazon"], [/\bnvidia\b|\bnvda\b/i, "nvda.us", "NVIDIA"], [/\bmeta platforms\b|\bfacebook\b/i, "meta.us", "Meta"], [/\bnetflix\b|\bnflx\b/i, "nflx.us", "Netflix"],
  [/\bs&p ?500\b|\bsp500\b/i, "^spx", "S&P 500"], [/\bnasdaq\b/i, "^ndq", "Nasdaq 100"], [/\bdow jones\b/i, "^dji", "Dow Jones"], [/\bibex(?: ?35)?\b/i, "^ibex", "IBEX 35"], [/\bdax\b/i, "^dax", "DAX"],
];

// ------------------------------------------------------------------------------------------------ España
const REGIONS: Array<[RegExp, string, string]> = [
  [/andaluc[ií]a|sevilla|c[oó]rdoba|m[aá]laga|c[aá]diz|granada|almer[ií]a|huelva|ja[eé]n/i, "ES-AN", "Andalucía"], [/catalu[ñn]a|barcelona/i, "ES-CT", "Cataluña"], [/madrid/i, "ES-MD", "Comunidad de Madrid"],
  [/valencia|comunitat valenciana|alicante|castell[oó]n/i, "ES-VC", "Comunitat Valenciana"], [/galicia|coru[ñn]a|vigo|pontevedra|lugo|ourense/i, "ES-GA", "Galicia"], [/pa[ií]s vasco|euskadi|bilbao|vizcaya|guip[uú]zcoa|[aá]lava/i, "ES-PV", "País Vasco"],
  [/castilla y le[oó]n|valladolid|salamanca|burgos|le[oó]n/i, "ES-CL", "Castilla y León"], [/castilla[- ]la mancha|toledo|albacete/i, "ES-CM", "Castilla-La Mancha"], [/arag[oó]n|zaragoza/i, "ES-AR", "Aragón"], [/asturias|oviedo/i, "ES-AS", "Asturias"],
  [/cantabria|santander/i, "ES-CB", "Cantabria"], [/navarra|pamplona/i, "ES-NC", "Navarra"], [/la rioja|logro[ñn]o/i, "ES-RI", "La Rioja"], [/murcia/i, "ES-MC", "Región de Murcia"], [/extremadura|badajoz|c[aá]ceres/i, "ES-EX", "Extremadura"],
  [/baleares|mallorca|menorca|ibiza|palma/i, "ES-IB", "Islas Baleares"], [/canarias|tenerife|las palmas|gran canaria/i, "ES-CN", "Canarias"],
];

// ------------------------------------------------------------------------------------------------ software
const APPS: Array<[RegExp, string, string]> = [
  [/\bollama\b/i, "gh:ollama/ollama", "Ollama"], [/\bvite\b/i, "gh:vitejs/vite", "Vite"], [/\bvs ?code|visual studio code\b/i, "gh:microsoft/vscode", "Visual Studio Code"], [/\bllama\.cpp\b/i, "gh:ggml-org/llama.cpp", "llama.cpp"],
  [/\breact\b/i, "gh:facebook/react", "React"], [/\btypescript\b/i, "gh:microsoft/TypeScript", "TypeScript"], [/\btailwind\b/i, "gh:tailwindlabs/tailwindcss", "Tailwind CSS"], [/\bbun\b/i, "gh:oven-sh/bun", "Bun"],
  [/\bnode(?:\.?js)?\b/i, "eol:nodejs", "Node.js"], [/\bpython\b/i, "eol:python", "Python"], [/\bubuntu\b/i, "eol:ubuntu", "Ubuntu"], [/\bpostgres(?:ql)?\b/i, "eol:postgresql", "PostgreSQL"], [/\bphp\b/i, "eol:php", "PHP"], [/\bwindows\b/i, "eol:windows", "Windows"],
];

const two = (n: number) => String(n).padStart(2, "0");
const ago = (ms: number, now: Date): string => {
  const min = Math.max(0, Math.round((now.getTime() - ms) / 60000));
  return min < 90 ? `hace ${min} min` : min < 60 * 36 ? `hace ${Math.round(min / 60)} h` : `hace ${Math.round(min / 1440)} días`;
};

export const CATALOG: Connector[] = [
  // ============================================================================ Tiempo y clima
  {
    id: "tiempo", name: "Tiempo (Open-Meteo)", group: "Tiempo y clima",
    summary: "Tiempo actual y previsión de 4 días de cualquier lugar del mundo.", provides: "Temperatura, sensación térmica, lluvia, viento, humedad, salida y puesta del sol.",
    examples: ["¿Qué tiempo hace en Sevilla mañana?", "¿Va a llover en Madrid?", "Temperatura en Buenos Aires"], site: "https://open-meteo.com/", limits: "Gratis para uso no comercial; muy generoso.",
    hosts: ["geocoding-api.open-meteo.com", "api.open-meteo.com"], params: [{ name: "place", label: "Lugar", placeholder: "Sevilla", required: true }], sample: { place: "Sevilla" }, ttl: 300,
    detect: (text) => {
      const weather = W("qu[eé] tiempo (?:hace|har[aá]|va a hacer)(?! falta)|c[oó]mo (?:est[aá]|va) el tiempo|el tiempo (?:en|para|hoy|ma[ñn]ana|esta semana|este fin de semana)|tiempo que (?:hace|har[aá])|previsi[oó]n (?:meteorol[oó]gica|del tiempo)|va a llover|llover[aá]|hay lluvia|lluvia (?:en|para|hoy|ma[ñn]ana)|hace (?:fr[ií]o|calor) en|cu[aá]ntos grados|clima (?:en|de|para)(?= [A-ZÁÉÍÓÚÑ])|temperatura (?:en|de|para)(?= [A-ZÁÉÍÓÚÑ])|temperatura (?:hoy|ma[ñn]ana|actual)", "u");
      const weatherLower = W("qu[eé] tiempo (?:hace|har[aá]|va a hacer)(?! falta)|c[oó]mo (?:est[aá]|va) el tiempo|el tiempo (?:en|para|hoy|ma[ñn]ana|esta semana|este fin de semana)|tiempo que (?:hace|har[aá])|previsi[oó]n (?:meteorol[oó]gica|del tiempo)|va a llover|llover[aá]|hay lluvia|lluvia (?:en|para|hoy|ma[ñn]ana)|hace (?:fr[ií]o|calor) en|cu[aá]ntos grados|temperatura (?:hoy|ma[ñn]ana|actual)", "iu");
      if (!weather.test(text) && !weatherLower.test(text)) return null;
      // El clima de otra época o del planeta no es el tiempo de hoy.
      if (/antig[uü]edad|hist[oó]ric|\bsiglos?\b|a[ñn]os? (?:atr[aá]s|pasados)|cambio clim[aá]tico|\b1\d{3}\b|\b20[01]\d\b/i.test(text)) return null;
      return { place: placeOf(text) };
    },
    run: async ({ place: name }, { get }) => {
      const p = await place(name!, get);
      const w = json<any>(await get(`https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset&timezone=auto&forecast_days=4`), "Open-Meteo");
      const c = w.current, d = w.daily;
      if (!c || !d?.time) throw new Error("Open-Meteo no devolvió la previsión.");
      const lines = [
        `Tiempo en ${placeName(p)}. Datos de Open-Meteo, actualizados a las ${hour(c.time)} (hora local del lugar).`,
        `AHORA: ${fmt(c.temperature_2m)} °C (sensación ${fmt(c.apparent_temperature)} °C), ${sky(c.weather_code)}, humedad ${fmt(c.relative_humidity_2m, 0)} %, viento ${fmt(c.wind_speed_10m, 0)} km/h, precipitación ${fmt(c.precipitation)} mm.`,
      ];
      d.time.forEach((day: string, i: number) => lines.push(`${i === 0 ? "HOY" : i === 1 ? "MAÑANA" : "DÍA"} (${weekday(day)}): mínima ${fmt(d.temperature_2m_min[i])} °C, máxima ${fmt(d.temperature_2m_max[i])} °C, ${sky(d.weather_code[i])}, probabilidad de lluvia ${fmt(d.precipitation_probability_max[i] ?? 0, 0)} %, lluvia total ${fmt(d.precipitation_sum[i] ?? 0)} mm, sale el sol a las ${hour(d.sunrise[i])} y se pone a las ${hour(d.sunset[i])}.`));
      return { title: `Tiempo en ${p.name} — Open-Meteo`, url: "https://open-meteo.com/", text: lines.join("\n") };
    },
  },
  {
    id: "aire", name: "Calidad del aire (Open-Meteo)", group: "Tiempo y clima",
    summary: "Índice de calidad del aire europeo y contaminantes ahora mismo.", provides: "Índice europeo (0–100+), PM10, PM2,5, dióxido de nitrógeno y ozono.",
    examples: ["¿Qué calidad del aire hay en Madrid?", "Contaminación en Barcelona"], site: "https://open-meteo.com/en/docs/air-quality-api", limits: "Gratis para uso no comercial.",
    hosts: ["geocoding-api.open-meteo.com", "air-quality-api.open-meteo.com"], params: [{ name: "place", label: "Lugar", placeholder: "Madrid", required: true }], sample: { place: "Madrid" }, ttl: 600,
    detect: (text) => (/\b(?:calidad del aire|contaminaci[oó]n(?: del aire)?|polvo sahariano|part[ií]culas pm)\b/i.test(text) ? { place: placeOf(text) } : null),
    run: async ({ place: name }, { get }) => {
      const p = await place(name!, get);
      const a = json<any>(await get(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${p.latitude}&longitude=${p.longitude}&current=european_aqi,pm10,pm2_5,nitrogen_dioxide,ozone&timezone=auto`), "Open-Meteo (aire)");
      const c = a.current;
      if (!c || typeof c.european_aqi !== "number") throw new Error("Open-Meteo no devolvió la calidad del aire.");
      const aqi = c.european_aqi as number;
      const level = aqi <= 20 ? "buena" : aqi <= 40 ? "razonable" : aqi <= 60 ? "moderada" : aqi <= 80 ? "mala" : aqi <= 100 ? "muy mala" : "extremadamente mala";
      return { title: `Calidad del aire en ${p.name} — Open-Meteo`, url: "https://open-meteo.com/en/docs/air-quality-api", text: `Calidad del aire en ${placeName(p)} a las ${hour(c.time)} (hora local). Índice europeo: ${fmt(aqi, 0)} → ${level}. PM10: ${fmt(c.pm10)} µg/m³, PM2,5: ${fmt(c.pm2_5)} µg/m³, dióxido de nitrógeno: ${fmt(c.nitrogen_dioxide)} µg/m³, ozono: ${fmt(c.ozone)} µg/m³. (Escala europea: 0–20 buena, 20–40 razonable, 40–60 moderada, 60–80 mala, 80–100 muy mala, más de 100 extremadamente mala.)` };
    },
  },
  // ============================================================================ Dinero
  {
    id: "divisas", name: "Divisas (Banco Central Europeo)", group: "Dinero",
    summary: "Tipos de cambio oficiales entre monedas y conversión de importes.", provides: "Cambio y conversión (euro, dólar, libra, yen, franco suizo, peso mexicano y más).",
    examples: ["¿Cuánto son 100 dólares en euros?", "A cuánto está el dólar", "1500 euros en libras"], site: "https://frankfurter.dev/", limits: "Sin clave ni límites. Se publica cada día laborable hacia las 16:00 (CET).",
    hosts: ["api.frankfurter.dev", "open.er-api.com"], params: [{ name: "amount", label: "Importe", placeholder: "100" }, { name: "from", label: "De (código)", placeholder: "USD", required: true }, { name: "to", label: "A (código)", placeholder: "EUR", required: true }], sample: { amount: "100", from: "USD", to: "EUR" }, ttl: 900,
    detect: (text) => {
      const mentioned = CURRENCIES.map(([re, code]) => ({ code, at: text.search(re) })).filter((m) => m.at >= 0).sort((a, b) => a.at - b.at).map((m) => m.code);
      if (!mentioned.length) return null;
      // «1500 euros en libras»: un importe, una moneda y «en/a» otra moneda, aunque no diga «cuánto».
      const conversion = mentioned.length >= 2 && /\d[\d.,]*\s*[\p{L}€$£¥]+(?:\s+(?:estadounidenses?|esterlinas?|suizos?|mexicanos?|argentinos?|canadienses?|australianos?))?\s+(?:en|a)\s+[\p{L}€$£¥]+/iu.test(text);
      if (!conversion && !W("cu[aá]nto|a cu[aá]nto|cambio|cotiza|tipo de cambio|convert\\w*|equivale|valen?|son").test(text)) return null;
      const amountRaw = /(\d[\d.,]*)/.exec(text)?.[1];
      const amount = amountRaw ? number(amountRaw.replace(/[.,]+$/, "")) : 1;
      if (!(amount > 0)) return null;
      const from = mentioned[0]!;
      const to = mentioned[1] ?? (from === "EUR" ? "USD" : "EUR");
      if (from === to) return null;
      return { amount: String(amount), from, to };
    },
    run: async ({ amount, from, to }, { get }) => {
      const value = Number(amount || 1);
      const a = String(from).toUpperCase(), b = String(to).toUpperCase();
      if (!CODE.test(a) || !CODE.test(b) || !(value > 0)) throw new Error("Indica dos monedas de 3 letras (por ejemplo USD y EUR) y un importe.");
      let converted: number | undefined, rate: number | undefined, date = "", origin = "Banco Central Europeo (vía Frankfurter)", url = "https://frankfurter.dev/";
      const res = await get(`https://api.frankfurter.dev/v1/latest?base=${a}&symbols=${b}&amount=${value}`);
      if (res.status >= 200 && res.status < 300) {
        const data = json<any>(res, "Frankfurter");
        converted = data.rates?.[b];
        date = data.date ?? "";
        if (typeof converted === "number") rate = converted / value;
      } else if (res.status !== 404 && res.status !== 422) need(res, "Frankfurter");
      if (typeof converted !== "number") {
        // El BCE no publica todas las monedas: se prueba con otra fuente abierta.
        const alt = json<any>(await get(`https://open.er-api.com/v6/latest/${a}`), "ExchangeRate-API (abierta)");
        rate = alt.rates?.[b];
        if (typeof rate !== "number") throw new Error(`No hay cotización de ${a} a ${b}.`);
        converted = rate * value;
        date = String(alt.time_last_update_utc ?? "").slice(0, 16);
        origin = "ExchangeRate-API (endpoint abierto)";
        url = "https://www.exchangerate-api.com/docs/free";
      }
      return { title: `${a} → ${b} — ${origin}`, url, text: `${fmt(value, 4)} ${a} = ${fmt(converted, 4)} ${b}. Tipo de cambio: 1 ${a} = ${fmt(rate!, 6)} ${b}. Cotización de referencia del ${date} (no es en tiempo real: ${origin.startsWith("Banco") ? "el BCE la publica cada día laborable sobre las 16:00 CET" : "se actualiza una vez al día"}). Fuente: ${origin}.` };
    },
  },
  {
    id: "cripto", name: "Criptomonedas (CoinGecko)", group: "Dinero",
    summary: "Precio actual de criptomonedas en euros y dólares, con la variación de 24 h.", provides: "Precio en EUR y USD y cambio en 24 horas.",
    examples: ["¿A cuánto está el bitcoin?", "Precio de ethereum", "¿Cuánto vale solana?"], site: "https://www.coingecko.com/en/api", limits: "Sin clave, uso no comercial con atribución; unas 10–30 consultas por minuto (se guardan 60 s).",
    hosts: ["api.coingecko.com"], params: [{ name: "coin", label: "Criptomoneda", placeholder: "bitcoin", required: true }], sample: { coin: "bitcoin" }, ttl: 60,
    detect: (text) => {
      if (!PRICE_WORDS.test(text)) return null;
      const hit = COINS.find(([re]) => re.test(text));
      return hit ? { coin: hit[1] } : null;
    },
    run: async ({ coin }, { get }) => {
      let id = String(coin).toLowerCase().trim();
      if (!/^[a-z0-9-]{2,60}$/.test(id)) throw new Error("Nombre de criptomoneda no válido.");
      const known = COINS.find(([, cg]) => cg === id);
      if (!known) {
        const found = json<any>(await get(`https://api.coingecko.com/api/v3/search?query=${enc(id)}`), "CoinGecko").coins?.[0];
        if (!found?.id) throw new Error(`No encuentro la criptomoneda «${id}».`);
        id = found.id;
      }
      const data = json<any>(await get(`https://api.coingecko.com/api/v3/simple/price?ids=${enc(id)}&vs_currencies=eur,usd&include_24hr_change=true&include_last_updated_at=true`), "CoinGecko")[id];
      if (!data || typeof data.eur !== "number") throw new Error(`CoinGecko no tiene precio de «${id}».`);
      const when = data.last_updated_at ? new Date(data.last_updated_at * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "hace instantes";
      const name = known?.[2] ?? id;
      return { title: `${name} — CoinGecko`, url: `https://www.coingecko.com/en/coins/${id}`, text: `${name}: ${fmt(data.eur, data.eur < 1 ? 5 : 2)} € (${data.eur_24h_change >= 0 ? "+" : ""}${fmt(data.eur_24h_change ?? 0, 2)} % en 24 h) · ${fmt(data.usd, data.usd < 1 ? 5 : 2)} US$ (${data.usd_24h_change >= 0 ? "+" : ""}${fmt(data.usd_24h_change ?? 0, 2)} % en 24 h). Última actualización: ${when}. Fuente: CoinGecko.` };
    },
  },
  {
    id: "bolsa", name: "Bolsa (Stooq, con retraso)", group: "Dinero",
    summary: "Cotización de acciones e índices famosos (con unos minutos de retraso).", provides: "Último precio, apertura, máximo, mínimo y volumen.",
    examples: ["Cotización de Apple", "¿Cómo va el S&P 500?", "Precio de las acciones de Tesla"], site: "https://stooq.com/", limits: "Sin clave; datos con retraso, no aptos para operar.",
    hosts: ["stooq.com"], params: [{ name: "symbol", label: "Símbolo de Stooq", placeholder: "aapl.us", required: true }], sample: { symbol: "aapl.us" }, ttl: 120,
    detect: (text) => {
      if (!/\b(?:cotizaci[oó]n|acciones?|bolsa|c[oó]mo va|precio de|cu[aá]nto (?:vale|cotiza)|cotiza)\b/i.test(text)) return null;
      const hit = STOCKS.find(([re]) => re.test(text));
      return hit ? { symbol: hit[1] } : null;
    },
    run: async ({ symbol }, { get }) => {
      const s = String(symbol).toLowerCase().trim();
      if (!/^[\^a-z0-9.\-]{1,20}$/.test(s)) throw new Error("Símbolo no válido.");
      const res = await get(`https://stooq.com/q/l/?s=${enc(s)}&f=sd2t2ohlcv&h&e=csv`);
      need(res, "Stooq");
      const rows = res.body.trim().split(/\r?\n/);
      const row = rows[1]?.split(",");
      if (!row || row.length < 8 || row[1] === "N/D") throw new Error(`Stooq no conoce el símbolo «${s}».`);
      const [sym, day, time, open, high, low, close, vol] = row as [string, string, string, string, string, string, string, string];
      const name = STOCKS.find(([, code]) => code === s)?.[2] ?? sym;
      return { title: `${name} — Stooq`, url: `https://stooq.com/q/?s=${enc(s)}`, text: `${name} (${sym}): último ${fmt(Number(close), 2)} (${day} ${time}). Apertura ${fmt(Number(open), 2)}, máximo ${fmt(Number(high), 2)}, mínimo ${fmt(Number(low), 2)}${vol && vol !== "N/D" ? `, volumen ${fmt(Number(vol), 0)}` : ""}. Datos con retraso, solo informativos. Fuente: Stooq.` };
    },
  },
  // ============================================================================ España
  {
    id: "luz", name: "Precio de la luz (Red Eléctrica)", group: "España",
    summary: "Precio de la electricidad en España hora a hora.", provides: "Precio actual, mínimo y máximo del día (€/kWh) del mercado y del PVPC.",
    examples: ["¿Cuánto cuesta la luz ahora?", "Precio de la luz hoy", "¿A qué hora es más barata la luz?"], site: "https://www.ree.es/es/apidatos", limits: "Sin clave. Datos oficiales de Red Eléctrica (REData).",
    hosts: ["apidatos.ree.es"], params: [], sample: {}, ttl: 300,
    detect: (text) => (/\b(?:precio|cu[aá]nto (?:cuesta|vale|est[aá])|cost(?:e|ar)|tarifa|barata|cara)\b.{0,40}\b(?:luz|electricidad|kwh|mwh)\b|\b(?:luz|electricidad)\b.{0,30}\b(?:hoy|ahora|ma[ñn]ana|a qu[eé] hora)\b/i.test(text) ? {} : null),
    run: async (_p, { get, now }) => {
      const day = madridDay(now);
      const data = json<any>(await get(`https://apidatos.ree.es/es/datos/mercados/precios-mercados-tiempo-real?start_date=${day}T00:00&end_date=${day}T23:59&time_trunc=hour`), "Red Eléctrica");
      const series = (data.included ?? []).filter((s: any) => Array.isArray(s?.attributes?.values) && s.attributes.values.length);
      if (!series.length) throw new Error("Red Eléctrica no devolvió precios para hoy.");
      const now_h = madridHour(now);
      const lines = [`Precio de la electricidad en España el ${day} (hora peninsular). Datos oficiales de Red Eléctrica (REData); consultado a las ${madridStamp(now)}.`];
      for (const s of series) {
        const title = String(s.attributes.title ?? s.type ?? "Precio");
        const values = (s.attributes.values as Array<{ value: number; datetime: string }>).map((v) => ({ v: v.value / 1000, h: Number(v.datetime.slice(11, 13)) }));
        const cur = values.find((x) => x.h === now_h);
        const min = values.reduce((a, b) => (b.v < a.v ? b : a)), max = values.reduce((a, b) => (b.v > a.v ? b : a));
        const avg = values.reduce((sum, x) => sum + x.v, 0) / values.length;
        lines.push(`${title.replace(/\(€\/MWh\)/, "").trim()}: ${cur ? `ahora (${two(now_h)}:00) ${fixed(cur.v, 4)} €/kWh; ` : ""}mínimo ${fixed(min.v, 4)} €/kWh a las ${two(min.h)}:00, máximo ${fixed(max.v, 4)} €/kWh a las ${two(max.h)}:00, media ${fixed(avg, 4)} €/kWh (${values.length} horas con dato).`);
      }
      return { title: "Precio de la luz hoy — Red Eléctrica (REData)", url: "https://www.ree.es/es/datos/mercados", text: lines.join("\n") };
    },
  },
  {
    id: "festivos", name: "Festivos (Nager.Date)", group: "España",
    summary: "Próximos festivos nacionales y autonómicos de España (u otro país).", provides: "Fecha y nombre de los festivos, con la comunidad a la que afectan.",
    examples: ["¿Cuál es el próximo festivo?", "Festivos en Andalucía", "Días festivos de este año"], site: "https://date.nager.at/", limits: "Sin clave.",
    hosts: ["date.nager.at"], params: [{ name: "country", label: "País (código)", placeholder: "ES" }, { name: "region", label: "Comunidad (código ISO)", placeholder: "ES-AN" }], sample: { country: "ES", region: "ES-AN" }, ttl: 3600,
    detect: (text) => {
      if (!/\b(?:festivos?|d[ií]as? festivos?|puentes?|pr[oó]ximo festivo|vacaciones? escolares?)\b/i.test(text)) return null;
      const region = REGIONS.find(([re]) => re.test(text));
      return { country: "ES", region: region?.[1] ?? "" };
    },
    run: async ({ country, region }, { get, now }) => {
      const cc = String(country || "ES").toUpperCase();
      if (!/^[A-Z]{2}$/.test(cc)) throw new Error("Código de país no válido (2 letras).");
      const year = Number(madridDay(now).slice(0, 4));
      const today = madridDay(now);
      let all: Array<{ date: string; localName: string; global?: boolean; counties?: string[] | null }> = [];
      for (const y of [year, year + 1]) {
        const list = json<any[]>(await get(`https://date.nager.at/api/v3/PublicHolidays/${y}/${cc}`), "Nager.Date");
        all = all.concat(list);
        if (all.filter((h) => h.date >= today).length >= 6) break;
      }
      const reg = String(region ?? "");
      const applies = (h: (typeof all)[number]) => !h.counties || h.counties.length === 0 || (reg && h.counties.includes(reg));
      const upcoming = all.filter((h) => h.date >= today && applies(h)).slice(0, 8);
      const regionName = REGIONS.find(([, code]) => code === reg)?.[2];
      const lines = [`Próximos festivos${cc === "ES" ? " en España" : ` (${cc})`}${regionName ? `, incluidos los de ${regionName}` : reg ? `, incluidos los de ${reg}` : " (solo los nacionales; di tu comunidad para incluir los autonómicos)"}. Hoy es ${today}.`];
      for (const h of upcoming) lines.push(`- ${weekday(h.date)} (${h.date}): ${h.localName}${h.counties?.length ? ` [solo ${h.counties.join(", ")}]` : ""}`);
      if (!upcoming.length) lines.push("No hay más festivos en la lista.");
      return { title: "Festivos — Nager.Date", url: `https://date.nager.at/PublicHoliday/Country/${cc}`, text: lines.join("\n") };
    },
  },
  // ============================================================================ Conocimiento
  {
    id: "wikipedia", name: "Wikipedia (español)", group: "Conocimiento",
    summary: "Resumen de un artículo de la Wikipedia en español.", provides: "Descripción, resumen y enlace del artículo, con la fecha de su última edición.",
    examples: ["¿Quién fue Cervantes?", "Busca en Wikipedia la fotosíntesis", "Según la Wikipedia, ¿qué es el Big Bang?"], site: "https://es.wikipedia.org/", limits: "Sin clave; texto libre (CC BY-SA).",
    hosts: ["es.wikipedia.org"], params: [{ name: "topic", label: "Tema", placeholder: "Miguel de Cervantes", required: true }], sample: { topic: "Miguel de Cervantes" }, ttl: 1800,
    detect: (text) => {
      const explicit = after(text, /(?:en|seg[uú]n) (?:la )?wikipedia[,:]?\s*(?:qu[eé] es |qui[eé]n es |qui[eé]n fue |sobre |de |el |la )?(.+)$/i) || after(text, /wikipedia[:,]?\s+(.+)$/i);
      if (explicit.length >= 2) return { topic: explicit };
      const who = /^\s*[¿]?\s*qui[eé]n (?:fue|era|es|son|eran)\s+((?:[A-ZÁÉÍÓÚÑ][^\s?¿,.]*)(?:\s+(?:de|del|la|los|las|y|[A-ZÁÉÍÓÚÑ][^\s?¿,.]*))*)/.exec(text);
      return who ? { topic: who[1]!.trim().replace(/[?¿!.,;:]+$/g, "") } : null;
    },
    run: async ({ topic }, { get }) => {
      const found = json<any>(await get(`https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${enc(topic!)}&srlimit=1&format=json&utf8=1`), "Wikipedia");
      const title = found.query?.search?.[0]?.title as string | undefined;
      if (!title) throw new Error(`No encuentro «${topic}» en la Wikipedia.`);
      const s = json<any>(await get(`https://es.wikipedia.org/api/rest_v1/page/summary/${enc(title.replace(/ /g, "_"))}`), "Wikipedia");
      if (!s.extract) throw new Error(`El artículo «${title}» no tiene resumen.`);
      return { title: `${s.title} — Wikipedia`, url: s.content_urls?.desktop?.page ?? `https://es.wikipedia.org/wiki/${enc(title.replace(/ /g, "_"))}`, text: `${s.title}${s.description ? ` (${s.description})` : ""}: ${clip(String(s.extract), 1800)}${s.timestamp ? ` [Última edición del artículo: ${String(s.timestamp).slice(0, 10)}]` : ""}` };
    },
  },
  {
    id: "diccionario", name: "Diccionario (español)", group: "Conocimiento",
    summary: "Definiciones de palabras en español.", provides: "Significados por categoría gramatical, con ejemplos si los hay.",
    examples: ["¿Qué significa efímero?", "Definición de resiliencia"], site: "https://dictionaryapi.dev/", limits: "Sin clave; cobertura irregular de palabras poco comunes.",
    hosts: ["api.dictionaryapi.dev"], params: [{ name: "word", label: "Palabra", placeholder: "efímero", required: true }], sample: { word: "efímero" }, ttl: 86400,
    detect: (text) => {
      const w = after(text, /^\s*[¿]?\s*(?:qu[eé] (?:significa|quiere decir)|significado de|definici[oó]n de|define|c[oó]mo se define)\s+(?:la palabra |el t[eé]rmino )?[«"']?([\p{L}-]+)[»"']?\s*[?]?\s*$/iu);
      return w ? { word: w.toLowerCase() } : null;
    },
    run: async ({ word }, { get }) => {
      const w = String(word).trim().toLowerCase();
      if (!/^[\p{L}-]{2,40}$/u.test(w)) throw new Error("Escribe una sola palabra.");
      const res = await get(`https://api.dictionaryapi.dev/api/v2/entries/es/${enc(w)}`);
      if (res.status === 404) throw new Error(`No encuentro «${w}» en el diccionario.`);
      const data = json<any[]>(res, "El diccionario");
      const lines: string[] = [];
      for (const entry of data.slice(0, 2)) for (const m of (entry.meanings ?? []).slice(0, 4)) {
        const defs = (m.definitions ?? []).slice(0, 3).map((d: any, i: number) => `${i + 1}. ${d.definition}${d.example ? ` (ej.: «${d.example}»)` : ""}`);
        if (defs.length) lines.push(`${m.partOfSpeech ?? ""}: ${defs.join(" ")}`);
      }
      if (!lines.length) throw new Error(`No hay definiciones de «${w}».`);
      return { title: `«${w}» — diccionario`, url: `https://api.dictionaryapi.dev/api/v2/entries/es/${enc(w)}`, text: `Definiciones de «${w}»:\n${lines.join("\n")}` };
    },
  },
  {
    id: "libros", name: "Libros (Open Library)", group: "Conocimiento",
    summary: "Busca libros por título, autor o tema.", provides: "Título, autores, año de la primera edición y enlace.",
    examples: ["Libros de Cervantes", "Libros sobre historia de Roma"], site: "https://openlibrary.org/developers/api", limits: "Sin clave.",
    hosts: ["openlibrary.org"], params: [{ name: "query", label: "Búsqueda", placeholder: "Cervantes", required: true }], sample: { query: "Cervantes" }, ttl: 3600,
    detect: (text) => {
      const q = after(text, /\blibros? (?:de|del|sobre|acerca de)\s+(.+)$/i);
      return q.length >= 3 ? { query: q } : null;
    },
    run: async ({ query }, { get }) => {
      const data = json<any>(await get(`https://openlibrary.org/search.json?q=${enc(query!)}&limit=6&fields=title,author_name,first_publish_year,key`), "Open Library");
      const docs = (data.docs ?? []) as Array<{ title: string; author_name?: string[]; first_publish_year?: number; key: string }>;
      if (!docs.length) throw new Error(`No hay libros para «${query}».`);
      return { title: `Libros: ${query} — Open Library`, url: `https://openlibrary.org/search?q=${enc(query!)}`, text: `Libros encontrados para «${query}» (${fmt(data.numFound ?? docs.length, 0)} resultados en total):\n${docs.map((d) => `- ${d.title}${d.author_name?.length ? ` — ${d.author_name.slice(0, 3).join(", ")}` : ""}${d.first_publish_year ? ` (${d.first_publish_year})` : ""} https://openlibrary.org${d.key}`).join("\n")}` };
    },
  },
  // ============================================================================ Mundo
  {
    id: "paises", name: "Países (REST Countries)", group: "Mundo",
    summary: "Ficha de un país: capital, población, idiomas, moneda…", provides: "Capital, población, superficie, región, idiomas, monedas y husos horarios.",
    examples: ["¿Cuál es la capital de Australia?", "Población de Francia", "¿Qué moneda usa Japón?"], site: "https://restcountries.com/", limits: "Sin clave.",
    hosts: ["restcountries.com"], params: [{ name: "country", label: "País", placeholder: "Australia", required: true }], sample: { country: "Australia" }, ttl: 86400,
    detect: (text) => {
      if (!/\b(?:capital|poblaci[oó]n|habitantes|superficie|idiomas?|lenguas?|moneda|divisa|huso horario|cu[aá]nta gente)\b/i.test(text)) return null;
      const c = /\b(?:de|del|en|tiene|usa)\s+((?:[A-ZÁÉÍÓÚÑ][\p{L}'.-]+)(?:\s+(?:de|del|la|los|las|y)?\s*[A-ZÁÉÍÓÚÑ][\p{L}'.-]+){0,2})/u.exec(text)?.[1];
      return c ? { country: c.replace(/[?¿!.,;:]+$/g, "") } : null;
    },
    run: async ({ country }, { get }) => {
      const fields = "name,capital,population,region,subregion,languages,currencies,area,timezones,cca2";
      let res = await get(`https://restcountries.com/v3.1/translation/${enc(country!)}?fields=${fields}&fullText=true`);
      if (res.status === 404) res = await get(`https://restcountries.com/v3.1/translation/${enc(country!)}?fields=${fields}`);
      if (res.status === 404) throw new Error(`No encuentro el país «${country}».`);
      const list = json<any[]>(res, "REST Countries");
      const c = list[0];
      if (!c) throw new Error(`No encuentro el país «${country}».`);
      const money = Object.values<any>(c.currencies ?? {}).map((m) => `${m.name} (${m.symbol ?? ""})`.replace(" ()", "")).join(", ");
      return { title: `${c.name?.common} — REST Countries`, url: "https://restcountries.com/", text: `${c.name?.official ?? c.name?.common} (${c.name?.common}, ${c.cca2}). Capital: ${(c.capital ?? []).join(", ") || "—"}. Población: ${fmt(c.population ?? 0, 0)} habitantes. Superficie: ${fmt(c.area ?? 0, 0)} km². Región: ${c.region}${c.subregion ? ` (${c.subregion})` : ""}. Idiomas: ${Object.values(c.languages ?? {}).join(", ") || "—"}. Moneda: ${money || "—"}. Husos horarios: ${(c.timezones ?? []).slice(0, 4).join(", ")}${(c.timezones ?? []).length > 4 ? "…" : ""}. (Cifra de población de la fuente; puede no ser la más reciente.)` };
    },
  },
  {
    id: "bancomundial", name: "Economía mundial (Banco Mundial)", group: "Mundo",
    summary: "PIB, inflación, paro, esperanza de vida… de cualquier país, por año.", provides: "Últimos años disponibles del indicador elegido.",
    examples: ["PIB de España", "Inflación en Argentina", "Paro en Italia"], site: "https://datahelpdesk.worldbank.org/knowledgebase/topics/125589", limits: "Sin clave. Datos anuales, con uno o dos años de retraso.",
    hosts: ["api.worldbank.org", "restcountries.com"], params: [{ name: "country", label: "País", placeholder: "España", required: true }, { name: "indicator", label: "Indicador (clave)", placeholder: "pib", required: true }], sample: { country: "España", indicator: "pib" }, ttl: 43200,
    detect: (text) => {
      const ind = /\bpib per c[aá]pita\b/i.test(text) ? "pibpc" : /\bpib\b|producto interior bruto/i.test(text) ? "pib" : /\binflaci[oó]n\b/i.test(text) ? "inflacion" : /\b(?:paro|desempleo)\b/i.test(text) ? "paro" : /esperanza de vida/i.test(text) ? "vida" : /\bdeuda p[uú]blica\b/i.test(text) ? "deuda" : "";
      if (!ind) return null;
      const c = /\b(?:de|del|en|para)\s+((?:[A-ZÁÉÍÓÚÑ][\p{L}'.-]+)(?:\s+(?:de|del|la|los|las|y)?\s*[A-ZÁÉÍÓÚÑ][\p{L}'.-]+){0,2})/u.exec(text)?.[1];
      return c ? { country: c.replace(/[?¿!.,;:]+$/g, ""), indicator: ind } : null;
    },
    run: async ({ country, indicator }, { get }) => {
      const IND: Record<string, [string, string, (v: number) => string]> = {
        pib: ["NY.GDP.MKTP.CD", "PIB (US$ corrientes)", (v) => `${big(v)} US$`], pibpc: ["NY.GDP.PCAP.CD", "PIB per cápita (US$)", (v) => `${fmt(v, 0)} US$`],
        inflacion: ["FP.CPI.TOTL.ZG", "Inflación (precios al consumidor, % anual)", (v) => `${fmt(v, 2)} %`], paro: ["SL.UEM.TOTL.ZS", "Desempleo (% de la población activa)", (v) => `${fmt(v, 2)} %`],
        vida: ["SP.DYN.LE00.IN", "Esperanza de vida al nacer (años)", (v) => `${fmt(v, 1)} años`], deuda: ["GC.DOD.TOTL.GD.ZS", "Deuda del gobierno central (% del PIB)", (v) => `${fmt(v, 1)} %`], poblacion: ["SP.POP.TOTL", "Población total", (v) => `${fmt(v, 0)} habitantes`],
      };
      const spec = IND[String(indicator)];
      if (!spec) throw new Error(`Indicador no disponible. Usa: ${Object.keys(IND).join(", ")}.`);
      const found = await get(`https://restcountries.com/v3.1/translation/${enc(country!)}?fields=cca2,name&fullText=true`);
      const code = found.status === 404 ? "" : (json<any[]>(found, "REST Countries")[0]?.cca2 as string | undefined) ?? "";
      const cc = code || (await (async () => { const alt = await get(`https://restcountries.com/v3.1/translation/${enc(country!)}?fields=cca2,name`); return alt.status === 404 ? "" : (json<any[]>(alt, "REST Countries")[0]?.cca2 as string | undefined) ?? ""; })());
      if (!cc) throw new Error(`No encuentro el país «${country}».`);
      const data = json<any[]>(await get(`https://api.worldbank.org/v2/country/${cc}/indicator/${spec[0]}?format=json&per_page=8&mrv=6`), "Banco Mundial");
      const rows = ((data[1] ?? []) as Array<{ date: string; value: number | null; country: { value: string } }>).filter((r) => r.value !== null);
      if (!rows.length) throw new Error(`El Banco Mundial no tiene datos de ${spec[1]} para ${country}.`);
      return { title: `${spec[1]} — ${rows[0]!.country.value} — Banco Mundial`, url: `https://data.worldbank.org/indicator/${spec[0]}?locations=${cc}`, text: `${spec[1]} de ${rows[0]!.country.value} (Banco Mundial, datos anuales):\n${rows.map((r) => `- ${r.date}: ${spec[2](r.value as number)}`).join("\n")}\n(El último año publicado suele tener uno o dos años de retraso.)` };
    },
  },
  {
    id: "terremotos", name: "Terremotos (USGS)", group: "Mundo",
    summary: "Terremotos de magnitud 4,5 o más en las últimas 24 horas, en todo el mundo.", provides: "Magnitud, lugar, hora, profundidad y enlace de cada sismo.",
    examples: ["¿Ha habido algún terremoto hoy?", "Últimos terremotos", "Terremotos en Japón"], site: "https://earthquake.usgs.gov/earthquakes/feed/", limits: "Sin clave. Se actualiza cada minuto.",
    hosts: ["earthquake.usgs.gov"], params: [{ name: "filter", label: "Filtrar por lugar (en inglés, opcional)", placeholder: "Japan" }], sample: {}, ttl: 120,
    detect: (text) => {
      if (!/\b(?:terremotos?|sismos?|temblor(?:es)?|se[ií]smos?)\b/i.test(text)) return null;
      const where = /\b(?:en|de)\s+(Jap[oó]n|M[eé]xico|Chile|Per[uú]|Indonesia|Turqu[ií]a|Grecia|Italia|Espa[ñn]a|Portugal|Marruecos|Nueva Zelanda|Filipinas|Ecuador|Colombia|Argentina)\b/i.exec(text)?.[1] ?? "";
      const EN: Record<string, string> = { japon: "Japan", mexico: "Mexico", chile: "Chile", peru: "Peru", indonesia: "Indonesia", turquia: "Turkey", grecia: "Greece", italia: "Italy", espana: "Spain", portugal: "Portugal", marruecos: "Morocco", "nueva zelanda": "New Zealand", filipinas: "Philippines", ecuador: "Ecuador", colombia: "Colombia", argentina: "Argentina" };
      return { filter: EN[where.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")] ?? "" };
    },
    run: async ({ filter }, { get, now }) => {
      const data = json<any>(await get("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson"), "USGS");
      let items = ((data.features ?? []) as any[]).map((f) => ({ mag: f.properties?.mag as number, place: String(f.properties?.place ?? ""), time: f.properties?.time as number, url: String(f.properties?.url ?? ""), depth: f.geometry?.coordinates?.[2] as number })).sort((a, b) => b.time - a.time);
      const f = String(filter ?? "").trim().toLowerCase();
      if (f) items = items.filter((i) => i.place.toLowerCase().includes(f));
      const total = data.metadata?.count ?? items.length;
      const head = `Terremotos de magnitud 4,5 o más en las últimas 24 horas${f ? ` cuyo lugar contiene «${filter}»` : ""} (USGS, generado ${data.metadata?.generated ? new Date(data.metadata.generated).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "ahora"}). En todo el mundo hubo ${total}.`;
      if (!items.length) return { title: "Terremotos — USGS", url: "https://earthquake.usgs.gov/earthquakes/map/", text: `${head}\nNo hay ninguno${f ? " en ese lugar" : ""} en este momento.` };
      return { title: "Terremotos — USGS", url: "https://earthquake.usgs.gov/earthquakes/map/", text: `${head}\n${items.slice(0, 8).map((i) => `- M${fmt(i.mag, 1)} — ${i.place} — ${ago(i.time, now)} (${new Date(i.time).toISOString().replace("T", " ").slice(0, 16)} UTC), profundidad ${fmt(i.depth, 0)} km`).join("\n")}` };
    },
  },
  {
    id: "noticias", name: "Noticias (BBC Mundo y El País)", group: "Mundo",
    summary: "Últimos titulares de dos medios en español.", provides: "Titulares recientes con fecha y enlace.",
    examples: ["Últimas noticias", "¿Qué ha pasado hoy?", "Titulares de hoy"], site: "https://www.bbc.com/mundo", limits: "Sin clave; solo titulares (RSS públicos).",
    hosts: ["feeds.bbci.co.uk", "feeds.elpais.com"], params: [], sample: {}, ttl: 300,
    detect: (text) => (W("[uú]ltimas noticias|noticias de hoy|titulares|qu[eé] (?:ha )?pas(?:a|ado|[oó]) hoy|qu[eé] est[aá] pasando|actualidad de hoy|las noticias").test(text) ? {} : null),
    run: async (_p, { get, now }) => {
      const feeds: Array<[string, string]> = [["BBC Mundo", "https://feeds.bbci.co.uk/mundo/rss.xml"], ["El País", "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada"]];
      const parts = await Promise.allSettled(feeds.map(async ([name, url]) => {
        const res = await get(url);
        need(res, name);
        const items = blocks(res.body, "item").slice(0, 6).map((it) => ({ title: inner(it, "title"), link: inner(it, "link"), date: inner(it, "pubDate") })).filter((i) => i.title);
        if (!items.length) throw new Error(`${name} no devolvió titulares.`);
        return `${name}:\n${items.map((i) => `- ${i.title}${i.date ? ` (${i.date.replace(/ [+-]\d{4}$/, "").replace(/ GMT$/, "")})` : ""} ${i.link}`).join("\n")}`;
      }));
      const ok = parts.flatMap((p) => (p.status === "fulfilled" ? [p.value] : []));
      if (!ok.length) throw new Error("No he podido leer ningún medio ahora mismo.");
      return { title: "Últimas noticias — BBC Mundo y El País", url: "https://www.bbc.com/mundo", text: `Titulares consultados a las ${madridStamp(now)} (solo titulares: si hace falta más, lee la noticia en el enlace).\n${ok.join("\n")}` };
    },
  },
  // ============================================================================ Ciencia y salud
  {
    id: "arxiv", name: "Artículos científicos (arXiv)", group: "Ciencia y salud",
    summary: "Últimos artículos (preprints) de física, matemáticas, informática e IA.", provides: "Título, autores, fecha, resumen y enlace.",
    examples: ["Artículos sobre transformers en arXiv", "Últimos papers de arxiv sobre difusión"], site: "https://info.arxiv.org/help/api/", limits: "Sin clave; máximo una consulta cada pocos segundos.",
    hosts: ["export.arxiv.org"], params: [{ name: "query", label: "Tema (mejor en inglés)", placeholder: "transformers", required: true }], sample: { query: "transformers" }, ttl: 900,
    detect: (text) => {
      if (!/\barxiv\b/i.test(text)) return null;
      const q = after(text, /(?:art[ií]culos?|papers?|preprints?|estudios?)\s+(?:recientes?\s+|nuevos?\s+|[uú]ltimos?\s+)?(?:sobre|de|acerca de)\s+(.+?)(?:\s+en\s+arxiv.*)?$/i) || after(text, /arxiv[:,]?\s+(.+)$/i);
      return q.length >= 3 ? { query: q } : null;
    },
    run: async ({ query }, { get }) => {
      const res = await get(`https://export.arxiv.org/api/query?search_query=all:${enc(query!)}&start=0&max_results=5&sortBy=submittedDate&sortOrder=descending`);
      need(res, "arXiv");
      const entries = blocks(res.body, "entry").map((e) => ({ title: inner(e, "title"), summary: inner(e, "summary"), date: inner(e, "published").slice(0, 10), url: inner(e, "id"), authors: blocks(e, "author").map((a) => inner(a, "name")).slice(0, 3) }));
      if (!entries.length) throw new Error(`arXiv no tiene artículos de «${query}».`);
      return { title: `arXiv: ${query}`, url: `https://arxiv.org/search/?query=${enc(query!)}&searchtype=all`, text: `Artículos más recientes de arXiv sobre «${query}» (preprints: aún no revisados por pares):\n${entries.map((e) => `- ${e.title} — ${e.authors.join(", ")} (${e.date}) ${e.url}\n  ${clip(e.summary, 320)}`).join("\n")}` };
    },
  },
  {
    id: "pubmed", name: "Estudios biomédicos (PubMed)", group: "Ciencia y salud",
    summary: "Artículos científicos de medicina y biología.", provides: "Título, autores, revista, fecha y enlace. Información científica, no consejo médico.",
    examples: ["Estudios en PubMed sobre diabetes", "Artículos de PubMed sobre sueño"], site: "https://www.ncbi.nlm.nih.gov/books/NBK25501/", limits: "Sin clave; hasta 3 consultas por segundo.",
    hosts: ["eutils.ncbi.nlm.nih.gov"], params: [{ name: "query", label: "Tema (mejor en inglés)", placeholder: "diabetes exercise", required: true }], sample: { query: "sleep memory" }, ttl: 900,
    detect: (text) => {
      if (!/\bpubmed\b/i.test(text)) return null;
      const q = after(text, /(?:art[ií]culos?|estudios?|papers?)\s+(?:cient[ií]ficos?\s+|m[eé]dicos?\s+)?(?:sobre|de|acerca de)\s+(.+?)(?:\s+en\s+pubmed.*)?$/i) || after(text, /pubmed[:,]?\s+(.+)$/i);
      return q.length >= 3 ? { query: q } : null;
    },
    run: async ({ query }, { get }) => {
      const s = json<any>(await get(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${enc(query!)}&retmax=5&retmode=json&sort=relevance`), "PubMed");
      const ids = (s.esearchresult?.idlist ?? []) as string[];
      if (!ids.length) throw new Error(`PubMed no tiene artículos de «${query}».`);
      const d = json<any>(await get(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(",")}&retmode=json`), "PubMed");
      const lines = ids.map((id) => { const r = d.result?.[id]; return r ? `- ${decode(String(r.title))} — ${(r.authors ?? []).slice(0, 3).map((a: any) => a.name).join(", ")}${(r.authors ?? []).length > 3 ? " et al." : ""}. ${r.source ?? ""} (${r.pubdate ?? ""}) https://pubmed.ncbi.nlm.nih.gov/${id}/` : ""; }).filter(Boolean);
      return { title: `PubMed: ${query}`, url: `https://pubmed.ncbi.nlm.nih.gov/?term=${enc(query!)}`, text: `Artículos de PubMed sobre «${query}» (${fmt(Number(s.esearchresult?.count ?? ids.length), 0)} en total). Es información científica, NO consejo médico:\n${lines.join("\n")}` };
    },
  },
  {
    id: "crossref", name: "Publicaciones y DOI (Crossref)", group: "Ciencia y salud",
    summary: "Busca publicaciones académicas o resuelve un DOI.", provides: "Título, autores, año, revista y enlace DOI.",
    examples: ["Busca en Crossref publicaciones sobre inteligencia artificial", "DOI 10.1038/nature14539"], site: "https://www.crossref.org/documentation/retrieve-metadata/rest-api/", limits: "Sin clave.",
    hosts: ["api.crossref.org"], params: [{ name: "query", label: "Tema o DOI", placeholder: "10.1038/nature14539", required: true }], sample: { query: "10.1038/nature14539" }, ttl: 3600,
    detect: (text) => {
      const doi = /\b(10\.\d{4,9}\/[^\s"<>]+)/.exec(text)?.[1]?.replace(/[.,;)]+$/, "");
      if (doi) return { query: doi };
      if (!/\bcrossref\b/i.test(text)) return null;
      const q = after(text, /(?:publicaciones?|art[ií]culos?|estudios?)\s+(?:acad[eé]micos?\s+)?(?:sobre|de|acerca de)\s+(.+?)(?:\s+en\s+crossref.*)?$/i) || after(text, /crossref[:,]?\s+(.+)$/i);
      return q.length >= 3 ? { query: q } : null;
    },
    run: async ({ query }, { get }) => {
      const q = String(query).trim();
      const fmtItem = (w: any) => `- ${(w.title ?? ["(sin título)"])[0]} — ${(w.author ?? []).slice(0, 3).map((a: any) => [a.given, a.family].filter(Boolean).join(" ")).join(", ")}${(w.author ?? []).length > 3 ? " et al." : ""}${w["container-title"]?.[0] ? `. ${w["container-title"][0]}` : ""}${w.issued?.["date-parts"]?.[0]?.[0] ? ` (${w.issued["date-parts"][0][0]})` : ""} https://doi.org/${w.DOI}`;
      if (/^10\.\d{4,9}\//.test(q)) {
        const res = await get(`https://api.crossref.org/works/${enc(q)}`);
        if (res.status === 404) throw new Error(`No encuentro el DOI ${q}.`);
        const w = json<any>(res, "Crossref").message;
        return { title: `DOI ${q} — Crossref`, url: `https://doi.org/${q}`, text: `Publicación con DOI ${q}:\n${fmtItem(w)}` };
      }
      const data = json<any>(await get(`https://api.crossref.org/works?query=${enc(q)}&rows=5&select=title,author,issued,DOI,container-title`), "Crossref");
      const items = (data.message?.items ?? []) as any[];
      if (!items.length) throw new Error(`Crossref no tiene publicaciones de «${q}».`);
      return { title: `Crossref: ${q}`, url: `https://search.crossref.org/?q=${enc(q)}`, text: `Publicaciones sobre «${q}» según Crossref:\n${items.map(fmtItem).join("\n")}` };
    },
  },
  // ============================================================================ Tecnología
  {
    id: "hackernews", name: "Tecnología (Hacker News)", group: "Tecnología",
    summary: "Lo más comentado hoy en tecnología, programación e IA.", provides: "Los 10 primeros con puntos, comentarios y enlace.",
    examples: ["Noticias de Hacker News", "¿Qué hay de nuevo en tecnología?"], site: "https://github.com/HackerNews/API", limits: "Sin clave.",
    hosts: ["hacker-news.firebaseio.com"], params: [], sample: {}, ttl: 300,
    detect: (text) => (/\bhacker ?news\b|\bqu[eé] hay de nuevo en tecnolog[ií]a\b|\bnoticias de tecnolog[ií]a\b/i.test(text) ? {} : null),
    run: async (_p, { get, now }) => {
      const ids = json<number[]>(await get("https://hacker-news.firebaseio.com/v0/topstories.json"), "Hacker News").slice(0, 10);
      const items = (await Promise.all(ids.map(async (id) => { try { return json<any>(await get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`), "Hacker News"); } catch { return null; } }))).filter((i): i is any => !!i?.title);
      if (!items.length) throw new Error("Hacker News no devolvió historias.");
      return { title: "Hacker News — lo más destacado", url: "https://news.ycombinator.com/", text: `Lo más destacado ahora en Hacker News (consultado a las ${madridStamp(now)}; los títulos están en inglés):\n${items.map((i, n) => `${n + 1}. ${i.title} — ${i.score} puntos, ${i.descendants ?? 0} comentarios — ${i.url ?? `https://news.ycombinator.com/item?id=${i.id}`}`).join("\n")}` };
    },
  },
  {
    id: "software", name: "Versiones de software", group: "Tecnología",
    summary: "Última versión de programas (Ollama, Node, Python, Vite…) y hasta cuándo tienen soporte.", provides: "Última versión, fecha de publicación y fin de soporte.",
    examples: ["¿Cuál es la última versión de Ollama?", "Versión actual de Node", "Última versión de Python"], site: "https://docs.github.com/rest/releases", limits: "Sin clave (GitHub: 60 consultas/hora).",
    hosts: ["api.github.com", "endoflife.date"], params: [{ name: "app", label: "Programa (o «propietario/repositorio» de GitHub)", placeholder: "ollama", required: true }], sample: { app: "ollama" }, ttl: 900,
    detect: (text) => {
      if (!W("[uú]ltima versi[oó]n|versi[oó]n (?:actual|m[aá]s reciente|nueva)|[uú]ltim[oa] release|qu[eé] versi[oó]n (?:hay|es la)").test(text)) return null;
      const repo = /\b([\w.-]+\/[\w.-]+)\b/.exec(text)?.[1];
      if (repo && !/^\d+\/\d+$/.test(repo)) return { app: repo };
      const known = APPS.find(([re]) => re.test(text));
      return known ? { app: known[1].replace(/^(?:gh|eol):/, "") === known[1] ? known[1] : known[2].toLowerCase() } : null;
    },
    run: async ({ app }, { get }) => {
      const wanted = String(app).trim();
      const known = APPS.find(([, , name]) => name.toLowerCase() === wanted.toLowerCase()) ?? APPS.find(([re]) => re.test(wanted));
      const target = known ? known[1] : /^[\w.-]+\/[\w.-]+$/.test(wanted) ? `gh:${wanted}` : `eol:${wanted.toLowerCase().replace(/[^a-z0-9.-]+/g, "-")}`;
      const label = known?.[2] ?? wanted;
      if (target.startsWith("gh:")) {
        const repo = target.slice(3);
        const res = await get(`https://api.github.com/repos/${repo}/releases/latest`);
        if (res.status === 404) throw new Error(`«${repo}» no tiene versiones publicadas en GitHub.`);
        const r = json<any>(res, "GitHub");
        return { title: `${label} ${r.tag_name} — GitHub`, url: r.html_url ?? `https://github.com/${repo}/releases`, text: `Última versión de ${label}: ${r.tag_name}${r.name && r.name !== r.tag_name ? ` («${r.name}»)` : ""}, publicada el ${String(r.published_at ?? "").slice(0, 10)}. Notas: ${clip(String(r.body ?? "").replace(/\s+/g, " "), 300)} Enlace: ${r.html_url ?? `https://github.com/${repo}/releases`}` };
      }
      const slug = target.slice(4);
      const res = await get(`https://endoflife.date/api/${enc(slug)}.json`);
      if (res.status === 404) throw new Error(`No conozco el programa «${wanted}». Prueba con «propietario/repositorio» de GitHub.`);
      const list = json<any[]>(res, "endoflife.date").slice(0, 4);
      return { title: `${label} — versiones (endoflife.date)`, url: `https://endoflife.date/${slug}`, text: `Versiones de ${label} (más recientes primero):\n${list.map((c) => `- Rama ${c.cycle}: última ${c.latest}${c.latestReleaseDate ? ` (${c.latestReleaseDate})` : ""}${c.lts ? ", LTS" : ""}; fin de soporte: ${c.eol === false ? "sin fecha" : c.eol === true ? "ya terminó" : c.eol}`).join("\n")}` };
    },
  },
  {
    id: "nasa", name: "NASA — imagen astronómica del día", group: "Tecnología",
    summary: "La imagen o vídeo astronómico que elige la NASA cada día, con su explicación.", provides: "Título, fecha, explicación (en inglés) y enlace.",
    examples: ["Imagen del día de la NASA", "¿Cuál es la foto astronómica de hoy?"], site: "https://api.nasa.gov/", limits: "Clave de demostración pública: unas 30 consultas por hora y 50 al día (se guarda 1 hora).",
    hosts: ["api.nasa.gov"], params: [], sample: {}, ttl: 3600,
    detect: (text) => (/\b(?:imagen|foto|fotograf[ií]a) (?:astron[oó]mica )?del d[ií]a (?:de la )?nasa\b|\bnasa\b.{0,30}\bimagen del d[ií]a\b|\bapod\b/i.test(text) ? {} : null),
    run: async (_p, { get }) => {
      const a = json<any>(await get("https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY"), "La NASA");
      if (!a.title) throw new Error("La NASA no devolvió la imagen del día.");
      return { title: `${a.title} — NASA APOD`, url: `https://apod.nasa.gov/apod/astropix.html`, text: `Imagen astronómica del día (${a.date}): «${a.title}»${a.copyright ? `, © ${String(a.copyright).trim()}` : ""}. Tipo: ${a.media_type}. Enlace: ${a.hdurl ?? a.url}. Explicación (original en inglés): ${clip(String(a.explanation), 1400)}` };
    },
  },
  // ============================================================================ Ocio y deporte
  {
    id: "deporte", name: "Deporte (TheSportsDB)", group: "Ocio y deporte",
    summary: "Últimos resultados y próximos partidos de un equipo.", provides: "Marcadores recientes y fecha de los próximos partidos.",
    examples: ["¿Cuándo juega el Sevilla?", "Resultado del último partido del Betis", "Próximo partido del Real Madrid"], site: "https://www.thesportsdb.com/", limits: "Clave de pruebas gratuita: cobertura y actualización limitadas (puede haber retraso).",
    hosts: ["www.thesportsdb.com"], params: [{ name: "team", label: "Equipo", placeholder: "Sevilla", required: true }], sample: { team: "Sevilla" }, ttl: 600,
    detect: (text) => {
      if (!W("cu[aá]ndo juega|pr[oó]ximo partido|[uú]ltimo partido|resultado (?:del|de la|de los)|c[oó]mo (?:qued[oó]|ha quedado|qued[aó]) el|marcador del").test(text)) return null;
      const t = /\b(?:juega|partido|resultado|qued[oó]|ha quedado|marcador)\s+(?:del|de la|de los|de las|de|el|la|los|las)\s+((?:[A-ZÁÉÍÓÚÑ][\p{L}'.-]+)(?:\s+(?:de|del|la|los|las|y|[A-ZÁÉÍÓÚÑ][\p{L}'.-]+))*)/u.exec(text)?.[1] ?? /\b(?:del|el)\s+((?:[A-ZÁÉÍÓÚÑ][\p{L}'.-]+)(?:\s+[A-ZÁÉÍÓÚÑ][\p{L}'.-]+)*)/u.exec(text)?.[1];
      return t ? { team: t.replace(/[?¿!.,;:]+$/g, "") } : null;
    },
    run: async ({ team }, { get }) => {
      const base = "https://www.thesportsdb.com/api/v1/json/3";
      const found = json<any>(await get(`${base}/searchteams.php?t=${enc(team!)}`), "TheSportsDB").teams as any[] | null;
      if (!found?.length) throw new Error(`No encuentro el equipo «${team}».`);
      const t = found.find((x) => /soccer|football/i.test(String(x.strSport))) ?? found[0];
      const [last, next] = await Promise.all([get(`${base}/eventslast.php?id=${t.idTeam}`).then((r) => json<any>(r, "TheSportsDB")).catch(() => ({})), get(`${base}/eventsnext.php?id=${t.idTeam}`).then((r) => json<any>(r, "TheSportsDB")).catch(() => ({}))]);
      const score = (e: any) => `${e.strHomeTeam} ${e.intHomeScore ?? "?"} - ${e.intAwayScore ?? "?"} ${e.strAwayTeam}`;
      const lines = [`${t.strTeam} (${t.strLeague ?? "liga desconocida"}${t.strCountry ? `, ${t.strCountry}` : ""}). Datos de TheSportsDB (clave gratuita: cobertura limitada, puede haber retraso).`];
      const done = (last.results ?? []) as any[], todo = (next.events ?? []) as any[];
      lines.push(done.length ? `ÚLTIMOS PARTIDOS:\n${done.slice(0, 3).map((e) => `- ${e.dateEvent}: ${score(e)} (${e.strLeague ?? ""})`).join("\n")}` : "No hay partidos recientes en la fuente.");
      lines.push(todo.length ? `PRÓXIMOS PARTIDOS:\n${todo.slice(0, 3).map((e) => `- ${e.dateEvent}${e.strTime ? ` ${String(e.strTime).slice(0, 5)} UTC` : ""}: ${e.strHomeTeam} - ${e.strAwayTeam} (${e.strLeague ?? ""})`).join("\n")}` : "No hay próximos partidos en la fuente.");
      return { title: `${t.strTeam} — TheSportsDB`, url: `https://www.thesportsdb.com/team/${t.idTeam}`, text: lines.join("\n") };
    },
  },
];
void RATE;
