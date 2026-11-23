const LETTER_PATTERN = /\p{L}/u;
const LETTERS_PATTERN = /\p{L}/gu;
const NUMERIC_MEASUREMENT_PATTERN = /^[+-]?\d+(?:[.,]\d+)?\s*(?:%|€|\$)$/u;
const HORIZONTAL_WHITESPACE_PATTERN = /[\t\f\v ]+/g;
const BULLET_PREFIX_PATTERN = /^[•·▪◦‣⁃*]+\s*/u;
const HYPHEN_PREFIX_PATTERN = /^(?:-+(?:\s+|(?=\p{L}))|[‐‑‒–—―]{2,}\s*|[‐‑‒–—―]\s+)/u;

const REPORT_SPELLING_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bvamos\s+a\s+humanizar\s+un\b/giu, 'vamos a humanizar un'],
  [/\bcaixabanj\b/giu, 'CaixaBank'],
  [/\bcmabiar\b/giu, 'cambiar'],
  [/\bcllientes\b/giu, 'clientes'],
  [/\bcloientes\b/giu, 'clientes'],
  [/\baunentar\b/giu, 'aumentar'],
  [/\bnumer\b/giu, 'número'],
  [/\bjovene\b/giu, 'jóvenes'],
  [/\bserl\b/giu, 'ser el'],
  [/\beligido\b/giu, 'elegido'],
  [/\bfasvorito\b/giu, 'favorito'],
  [/\benc\s+aptacion\b/giu, 'en captación'],
  [/\batoda\b/giu, 'a toda'],
  [/\brefernecias\b/giu, 'referencias'],
  [/\bpodemose\b/giu, 'podemos'],
  [/\batreer\b/giu, 'atraer'],
  [/\bextranjetros\b/giu, 'extranjeros'],
  [/\bquew\b/giu, 'que'],
  [/\bnoz\b/giu, 'nos'],
  [/\brferencia\b/giu, 'referencia'],
  [/\bteelmatico\b/giu, 'telemático'],
  [/\bactulizar\b/giu, 'actualizar'],
  [/\bpoteciar\b/giu, 'potenciar'],
  [/\bfacilicidad\b/giu, 'facilidad'],
  [/\bfacililidad\b/giu, 'facilidad'],
  [/\besucela\b/giu, 'escuela'],
  [/\bescuacha\b/giu, 'escucha'],
  [/\bespacion\b/giu, 'espacios'],
  [/\bcomuniacion\b/giu, 'comunicación'],
  [/\bbonificiacion\b/giu, 'bonificación'],
  [/\bprescipcion\b/giu, 'prescripción'],
  [/\badiocional\b/giu, 'adicional'],
  [/\baplio\b/giu, 'amplio'],
  [/\bconcrecci[oó]n\b/giu, 'concreción'],
  [/\bbreakeven\b/giu, 'break-even'],
  [/\bse\s+da\s+por\s+echo\b/giu, 'se da por hecho'],
  [/\bd\s+elos\b/giu, 'de los'],
  [/\bs\s+eden\b/giu, 'se den'],
  [/\benb\b/giu, 'en'],
  [/\bconcilacion\b/giu, 'conciliación'],
  [/\by\s+outube\b/giu, 'YouTube'],
  [/\btik\s+tok\b/giu, 'TikTok'],
  [/\besponsor\b/giu, 'espónsor'],
  [/\btraian\b/giu, 'traigan'],
  [/\bsino\s+va\b/giu, 'si no va'],
  [/\ben\s+cuanta\s+captacion\b/giu, 'en cuanto a captación'],
  [/\b40\s*[´'’]\s*65\b/giu, '40-65'],
  [/\bcliente\s+rentables\b/giu, 'clientes rentables'],
  [/\bm[aá]s\s+cliente\b/giu, 'más clientes'],
  [/\bIA\s+Para\b/gu, 'IA para'],
  [/\bpublico\s+objetivo\b/giu, 'público objetivo'],
  [/\bambito\s+publico\b/giu, 'ámbito público'],
  [/\bcastilla\s+y\s+leon\b/giu, 'Castilla y León'],
  [/\ben\s+que\s+direccion\b/giu, 'en qué dirección'],
  [/\bporque\s+eligen\b/giu, 'por qué eligen'],
  [/\bpreguntar\s+a\s+cliente\s+cual\s+es\b/giu, 'preguntar al cliente cuál es'],
  [/^\s*que\s+metodos\b/gimu, 'qué métodos'],
  [/^\s*si(?=\s*[,;:.])/gimu, 'sí'],
  [/\bhumanizar\s+Un\b/giu, 'humanizar un'],
  [/\bser\s+el\s+mejora\s+banco\b/giu, 'ser el mejor banco'],
  [/\bdiriginos\b/giu, 'dirigirnos'],
  [/\bcomptencia\b/giu, 'competencia'],
  [/\btecnolgia\b/giu, 'tecnología'],
  [/\bproductivad\b/giu, 'productividad'],
  [/\bbreack\s*even\b/giu, 'break-even'],
  [/\brestiling\b/giu, 'rediseño'],
  [/\bibueno(s?)\b/giu, 'bueno$1'],
  [/\bdir[¡i]ferenciacion\b/giu, 'diferenciación'],
  [/\bcompania\b/giu, 'compañía'],
  [/\bcompañia\b/giu, 'compañía'],
  [/\bcomodo(s?)\b/giu, 'cómodo$1'],
  [/\bunico(s?)\b/giu, 'único$1'],
  [/\bautonomo(s?)\b/giu, 'autónomo$1'],
  [/\baficion\b/giu, 'afición'],
  [/\bmedico(s?)\b/giu, 'médico$1'],
  [/\bfacil(es)?\b/giu, 'fácil$1'],
  [/\borigenes\b/giu, 'orígenes'],
  [/\bopciones\b/giu, 'opciones'],
  [/\bopcion\b/giu, 'opción'],
  [/\bmovil(es)?\b/giu, 'móvil$1'],
  [/\bseleccion\b/giu, 'selección'],
  [/\bformacion\b/giu, 'formación'],
  [/\bmotivacion\b/giu, 'motivación'],
  [/\bprescripcion\b/giu, 'prescripción'],
  [/\bambito(s?)\b/giu, 'ámbito$1'],
  [/\butil(es)?\b/giu, 'útil$1'],
  [/\bconciliacion\b/giu, 'conciliación'],
  [/\btelematico(s?)\b/giu, 'telemático$1'],
  [/\bintervenciones\b/giu, 'intervenciones'],
  [/\bintervencion\b/giu, 'intervención'],
  [/\bexplicito(s?)\b/giu, 'explícito$1'],
  [/\bresoluciones\b/giu, 'resoluciones'],
  [/\bresolucion\b/giu, 'resolución'],
  [/\bespectaculo(s?)\b/giu, 'espectáculo$1'],
  [/\bvinculo(s?)\b/giu, 'vínculo$1'],
  [/\bbusqueda(s?)\b/giu, 'búsqueda$1'],
  [/\bbebe(s?)\b/giu, 'bebé$1'],
  [/\beducacion\b/giu, 'educación'],
  [/\bmaster(es)?\b/giu, 'máster$1'],
  [/\bnomina(s?)\b/giu, 'nómina$1'],
  [/\bjubilacion\b/giu, 'jubilación'],
  [/\bespecifico(s?)\b/giu, 'específico$1'],
  [/\bespecifica(s?)\b/giu, 'específica$1'],
  [/\bproposito(s?)\b/giu, 'propósito$1'],
  [/\bcontaminacion\b/giu, 'contaminación'],
  [/\bcaida(s?)\b/giu, 'caída$1'],
  [/\bpagina(s?)\b/giu, 'página$1'],
  [/\btelefono(s?)\b/giu, 'teléfono$1'],
  [/\bseran\b/giu, 'serán'],
  [/\busaran\b/giu, 'usarán'],
  [/\bque\s+sera\b/giu, 'que será'],
  [/\bdirecciones\b/giu, 'direcciones'],
  [/\bdireccion\b/giu, 'dirección'],
  [/\blinea(s?)\b/giu, 'línea$1'],
  [/\bmetodo(s?)\b/giu, 'método$1'],
  [/\bvideo(s?)\b/giu, 'vídeo$1'],
  [/\bhablais\b/giu, 'habláis'],
  [/\bfuente\s+no\s+valida\b/giu, 'fuente no válida'],
  [/\bpor\s+que\s+no(?=\s*[?¿!¡.]|$)/giu, 'por qué no'],
  [/\bel\s+pq\b/giu, 'el porqué'],
  [/\bsaber\s+quien\s+son\b/giu, 'saber quiénes son'],
  [/\bsaber\s+que\s+es\b/giu, 'saber qué es'],
  [/\btecnologia(s?)\b/giu, 'tecnología$1'],
  [/\btecnologica(s?)\b/giu, 'tecnológica$1'],
  [/\bcomunicacion\b/giu, 'comunicación'],
  [/\bgeneracion\b/giu, 'generación'],
  [/\bpercepcion\b/giu, 'percepción'],
  [/\bimplantacion\b/giu, 'implantación'],
  [/\binformacion\b/giu, 'información'],
  [/\bdificil\b/giu, 'difícil'],
  [/\bdiferenciacion\b/giu, 'diferenciación'],
  [/\butilizacion\b/giu, 'utilización'],
  [/\beconomico(s?)\b/giu, 'económico$1'],
  [/\bcontratacion\b/giu, 'contratación'],
  [/\binversion\b/giu, 'inversión'],
  [/\bfidelizacion\b/giu, 'fidelización'],
  [/\bcaptacion\b/giu, 'captación'],
  [/\bbonificacion\b/giu, 'bonificación'],
  [/\bpromociones\b/giu, 'promociones'],
  [/\bpromocion\b/giu, 'promoción'],
  [/\bfuncion\b/giu, 'función'],
  [/\blimite\b/giu, 'límite'],
  [/\bdeposito\b/giu, 'depósito'],
  [/\bjovenes\b/giu, 'jóvenes'],
  [/\bnumero\b/giu, 'número'],
  [/\blideres\b/giu, 'líderes'],
  [/\blider\b/giu, 'líder'],
  [/\badversion\b/giu, 'aversión'],
  [/\brecien\b/giu, 'recién'],
  [/\bpoblacion\b/giu, 'población'],
  [/\btraves\b/giu, 'través'],
  [/\bclinica\b/giu, 'clínica'],
  [/\bprestamo\b/giu, 'préstamo'],
  [/\bsensacion\b/giu, 'sensación'],
  [/\bcercania\b/giu, 'cercanía'],
  [/\bagil\b/giu, 'ágil'],
  [/\bgeografica\b/giu, 'geográfica'],
  [/\bcanibalizacion\b/giu, 'canibalización'],
  [/\bdia\b/giu, 'día'],
  [/\basi\b/giu, 'así'],
  [/\bmas\b/giu, 'más'],
  [/\bclientesn\b/giu, 'clientes'],
  [/\binteligence\b/giu, 'intelligence'],
  [/\btrendingtopic\b/giu, 'trending topic'],
  [/\brr\s+ss\b/giu, 'RRSS'],
  [/\bq\b/giu, 'que'],
];

const capitalizeFirstVisibleLetter = (value: string): string => {
  const match = LETTER_PATTERN.exec(value);
  if (!match || match.index === undefined) return value;
  const letter = match[0];
  return `${value.slice(0, match.index)}${letter.toLocaleUpperCase('es-ES')}${value.slice(match.index + letter.length)}`;
};

const preserveReplacementCase = (match: string, replacement: string): string => {
  const letters = match.match(/\p{L}/gu) || [];
  const uppercaseLetters = letters.filter((letter) => (
    letter === letter.toLocaleUpperCase('es-ES')
    && letter !== letter.toLocaleLowerCase('es-ES')
  )).length;
  if (letters.length > 0 && uppercaseLetters === letters.length) {
    return replacement.toLocaleUpperCase('es-ES');
  }
  const firstLetter = LETTER_PATTERN.exec(match)?.[0];
  if (firstLetter && firstLetter === firstLetter.toLocaleUpperCase('es-ES')) {
    return capitalizeFirstVisibleLetter(replacement);
  }
  return replacement;
};

const stripLeadingListMarkers = (value: string): { text: string; stripped: boolean } => {
  let text = value.trim();
  let stripped = false;

  while (text) {
    const bulletMatch = text.match(BULLET_PREFIX_PATTERN);
    const hyphenMatch = text.match(HYPHEN_PREFIX_PATTERN);
    const match = bulletMatch || hyphenMatch;
    if (!match) break;
    text = text.slice(match[0].length).trimStart();
    stripped = true;
  }

  return { text, stripped };
};

/**
 * Cleans participant-authored copy for customer-facing report artifacts.
 * It deliberately preserves the original casing after the first visible letter
 * so acronyms and brand spellings are not destroyed.
 */
export const sanitizeReportEntry = (value: string): string => {
  const lines = value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => stripLeadingListMarkers(
      line.replace(HORIZONTAL_WHITESPACE_PATTERN, ' ').trim(),
    ))
    .filter(({ text }) => text.length > 0)
    .map(({ text, stripped }, index) => (
      index === 0 || stripped ? capitalizeFirstVisibleLetter(text) : text
    ));

  const normalized = lines.join('\n').trim();
  const letterCount = normalized.match(LETTERS_PATTERN)?.length || 0;
  return letterCount >= 2 || NUMERIC_MEASUREMENT_PATTERN.test(normalized) ? normalized : '';
};

export const isMeaningfulReportEntry = (value: string): boolean =>
  sanitizeReportEntry(value).length > 0;

export const sanitizeReportList = (values: readonly string[]): string[] => values
  .flatMap((value) => value.replace(/\r\n?/g, '\n').split('\n'))
  .map(sanitizeReportEntry)
  .filter(Boolean);

/**
 * Applies conservative, deterministic proofreading to customer-facing copy.
 * It fixes high-confidence spelling, punctuation and spacing issues without
 * mutating the stored workshop data or guessing at the author's meaning.
 */
export const proofreadReportDisplay = (value: string): string => {
  let proofread = value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/\s+([,.;:!?])/gu, '$1')
    .replace(/([¿¡])\s+/gu, '$1')
    .replace(/\.\s*,/gu, '.')
    .replace(/\(\s+/gu, '(')
    .replace(/\s+\)/gu, ')')
    .replace(/\)(?=\p{L})/gu, ') ')
    .replace(/([,;:])(?=\p{L})/gu, '$1 ')
    .replace(/\.(?=\p{L})/gu, '. ')
    .replace(/^\s*[\u0060´']+(?=\p{L})/gmu, '');

  REPORT_SPELLING_REPLACEMENTS.forEach(([pattern, replacement]) => {
    proofread = proofread.replace(pattern, (match, suffix: unknown) => {
      const expanded = replacement.includes('$1')
        ? replacement.replace('$1', typeof suffix === 'string' ? suffix : '')
        : replacement;
      return preserveReplacementCase(match, expanded);
    });
  });

  return proofread
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
};
