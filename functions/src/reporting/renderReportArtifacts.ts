import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import PptxGenJS from 'pptxgenjs';
import type {
  ReportBlock,
  ReportDeck,
  ReportDeckPage,
  ReportTeamName,
} from '../../../shared/reporting.js';

const PAGE = { width: 841.89, height: 595.28 };
const SLIDE = { width: 11.693, height: 8.268 };
const COLORS = {
  ink: '#102F41',
  muted: '#61727D',
  light: '#F4F7F9',
  rule: '#DCE4E8',
  purple: '#A2549C',
  purpleDark: '#743B70',
  white: '#FFFFFF',
  editorial: '#FFF7E7',
};
const TEAM_COLORS: Record<ReportTeamName, string> = {
  Agua: '#478DCF',
  Aire: '#56C6C8',
  Fuego: '#EF6D65',
  Tierra: '#66A66F',
};

export interface ReportAssets {
  logo?: Buffer;
  teams: Partial<Record<ReportTeamName, Buffer>>;
  fonts: {
    regular?: Buffer;
    semibold?: Buffer;
    bold?: Buffer;
  };
}

export const loadReportAssets = async (
  root = join(process.cwd(), 'assets', 'report'),
): Promise<ReportAssets> => {
  const optionalRead = async (name: string) => {
    try {
      return await readFile(join(root, name));
    } catch {
      return undefined;
    }
  };
  const [logo, Agua, Aire, Fuego, Tierra, regular, semibold, bold] = await Promise.all([
    optionalRead('logo.png'),
    optionalRead('agua.png'),
    optionalRead('aire.png'),
    optionalRead('fuego.png'),
    optionalRead('tierra.png'),
    optionalRead('Montserrat-Regular.ttf'),
    optionalRead('Montserrat-SemiBold.ttf'),
    optionalRead('Montserrat-Bold.ttf'),
  ]);
  return { logo, teams: { Agua, Aire, Fuego, Tierra }, fonts: { regular, semibold, bold } };
};

const collectPdf = (document: PDFKit.PDFDocument) => new Promise<Buffer>((resolve, reject) => {
  const chunks: Buffer[] = [];
  document.on('data', (chunk: Buffer | Uint8Array) => chunks.push(Buffer.from(chunk)));
  document.on('end', () => resolve(Buffer.concat(chunks)));
  document.on('error', reject);
});
const capitalizeFirstLetter = (value: string): string => value.replace(
  /^(\s*)(\p{L})/u,
  (_match, spacing: string, letter: string) => `${spacing}${letter.toLocaleUpperCase('es-ES')}`,
);
const sentenceCaseDisplay = (value: string): string => {
  const normalized = value.trim();
  if (!normalized || normalized.includes('KREATUM')) return capitalizeFirstLetter(normalized);
  const letters = normalized.match(/\p{L}/gu)?.join('') || '';
  const isAllUppercase = letters.length > 3
    && letters === letters.toLocaleUpperCase('es-ES')
    && letters !== letters.toLocaleLowerCase('es-ES');
  return capitalizeFirstLetter(isAllUppercase ? normalized.toLocaleLowerCase('es-ES') : normalized);
};


type PdfFontNames = { regular: string; bold: string };
const pdfFontNames = new WeakMap<PDFKit.PDFDocument, PdfFontNames>();

const fitPdfFontSize = (
  document: PDFKit.PDFDocument,
  text: string,
  options: { width: number; height: number; maxFontSize: number; minFontSize: number; bold?: boolean },
) => {
  const fontName = options.bold
    ? (pdfFontNames.get(document)?.bold || 'Helvetica-Bold')
    : (pdfFontNames.get(document)?.regular || 'Helvetica');
  const displayText = capitalizeFirstLetter(text);
  document.font(fontName);
  for (let fontSize = options.maxFontSize; fontSize >= options.minFontSize; fontSize -= 1) {
    document.fontSize(fontSize);
    if (document.heightOfString(displayText, { width: options.width, lineGap: 3 }) <= options.height) {
      return fontSize;
    }
  }
  throw new Error('The report cover title exceeds the printable area.');
};

const registerPdfFonts = (document: PDFKit.PDFDocument, assets: ReportAssets) => {
  let regular = 'Helvetica';
  let bold = 'Helvetica-Bold';
  if (assets.fonts.regular) {
    document.registerFont('ReportMontserrat', assets.fonts.regular);
    regular = 'ReportMontserrat';
  }
  const strongFont = assets.fonts.bold || assets.fonts.semibold;
  if (strongFont) {
    document.registerFont('ReportMontserratBold', strongFont);
    bold = 'ReportMontserratBold';
  }
  pdfFontNames.set(document, { regular, bold });
};


const pdfText = (
  document: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  options: PDFKit.Mixins.TextOptions & { width: number; fontSize?: number; color?: string; bold?: boolean },
) => {
  const { fontSize = 12, color = COLORS.ink, bold = false, ...textOptions } = options;
  document
    .font(bold ? (pdfFontNames.get(document)?.bold || 'Helvetica-Bold') : (pdfFontNames.get(document)?.regular || 'Helvetica'))
    .fontSize(fontSize)
    .fillColor(color)
    .text(capitalizeFirstLetter(text), x, y, { lineGap: 3, ...textOptions });
};

const drawPdfBrand = (document: PDFKit.PDFDocument, page: ReportDeckPage, assets: ReportAssets) => {
  const accent = page.team ? TEAM_COLORS[page.team] : COLORS.purple;
  document.rect(0, 0, PAGE.width, PAGE.height).fill(COLORS.white);
  document.rect(0, 0, 13, PAGE.height).fill(accent);
  if (assets.logo) {
    document.image(assets.logo, 48, 26, { fit: [105, 34] });
  } else {
    pdfText(document, 'KREATUM™', 48, 31, { width: 130, fontSize: 16, bold: true, color: COLORS.purple });
  }
  pdfText(document, page.section.toUpperCase(), 620, 30, {
    width: 165, fontSize: 9, bold: true, color: COLORS.muted, align: 'right', characterSpacing: 1.1,
  });
  document.moveTo(48, 67).lineTo(793, 67).lineWidth(0.7).strokeColor(COLORS.rule).stroke();
  if (page.team && assets.teams[page.team]) {
    document.image(assets.teams[page.team] as Buffer, 746, 79, { fit: [40, 40] });
  }
  pdfText(document, page.title, 48, 83, {
    width: page.team ? 675 : 735, fontSize: 25, bold: true, color: COLORS.ink,
  });
  if (page.subtitle) {
    pdfText(document, sentenceCaseDisplay(page.subtitle), 48, 124, { width: 700, fontSize: 12, color: COLORS.muted });
  }
  pdfText(document, `KREATUM™ · ${page.pageNumber}/${page.totalPages}`, 48, 566, {
    width: 735, fontSize: 9, color: COLORS.muted, align: 'right',
  });
};

const renderPdfMetrics = (document: PDFKit.PDFDocument, block: Extract<ReportBlock, { kind: 'metrics' }>) => {
  const startX = 48;
  const startY = 170;
  const gapX = 16;
  const gapY = 16;
  const width = (745 - gapX * 3) / 4;
  const height = 122;
  block.items.forEach((item, index) => {
    const column = index % 4;
    const row = Math.floor(index / 4);
    const x = startX + column * (width + gapX);
    const y = startY + row * (height + gapY);
    document.roundedRect(x, y, width, height, 12).fill(COLORS.light);
    pdfText(document, item.value, x + 14, y + 24, { width: width - 28, fontSize: 30, bold: true, color: COLORS.purple });
    pdfText(document, item.label, x + 14, y + 75, { width: width - 28, fontSize: 12, bold: true, color: COLORS.muted });
  });
};

type ReportDecisionBlocks = {
  list: Extract<ReportBlock, { kind: 'list' }>;
  votes: Extract<ReportBlock, { kind: 'votes' }>;
  choice: Extract<ReportBlock, { kind: 'text' }>;
};

const getDecisionBlocks = (page: ReportDeckPage): ReportDecisionBlocks | null => {
  if (!['priority', 'solutions'].includes(page.sectionId) || page.blocks.length !== 3) return null;
  const list = page.blocks.find((block): block is ReportDecisionBlocks['list'] => block.kind === 'list');
  const votes = page.blocks.find((block): block is ReportDecisionBlocks['votes'] => block.kind === 'votes');
  const choice = page.blocks.find((block): block is ReportDecisionBlocks['choice'] => block.kind === 'text');
  return list && votes && choice ? { list, votes, choice } : null;
};

type ReportDecisionRow = { text: string; votes: number | null };

const getDecisionRows = (decision: ReportDecisionBlocks): ReportDecisionRow[] => {
  const rows = decision.list.items.map((text) => ({ text, votes: decision.votes.items.find((item) => item.option === text)?.votes ?? null }));
  const listed = new Set(decision.list.items);
  decision.votes.items.forEach((item) => {
    if (!listed.has(item.option)) rows.push({ text: item.option, votes: item.votes });
  });
  return rows;
};

const estimateContrastLineCount = (block: Extract<ReportBlock, { kind: 'contrast' }>): number => (
  Math.max(1, Math.ceil(block.attack.length / 38), Math.ceil(block.defense.length / 38))
);

const renderPdfBlocks = (document: PDFKit.PDFDocument, page: ReportDeckPage) => {
  if (page.blocks.length === 1 && page.blocks[0].kind === 'metrics') {
    renderPdfMetrics(document, page.blocks[0]);
    return;
  }
  const decision = getDecisionBlocks(page);
  if (decision) {
    const accent = decision.choice.accent || decision.list.accent || COLORS.purple;
    const topY = page.subtitle ? 161 : 145;
    const topHeight = 250;
    const gapX = 14;
    const columnWidth = (745 - gapX) / 2;
    const bottomY = topY + topHeight + 12;
    const bottomHeight = 138;
    const decisionRows = getDecisionRows(decision);
    const drawCard = (x: number, y: number, width: number, height: number) => {
      document.roundedRect(x, y, width, height, 9).fill(COLORS.light);
      document.rect(x, y, 5, height).fill(accent);
    };

    drawCard(48, topY, 745, topHeight);
    pdfText(document, (decision.list.label || 'Preselección').toUpperCase(), 68, topY + 15, { width: columnWidth - 40, fontSize: 9.5, bold: true, color: accent });
    const listStartY = topY + 44;
    pdfText(document, decision.votes.label.toUpperCase(), 615, topY + 15, { width: 150, fontSize: 9.5, bold: true, color: accent, align: 'right' });
    const rowWeights = decisionRows.map((item) => Math.max(1, Math.ceil(item.text.length / 70)));
    const rowWeightTotal = Math.max(1, rowWeights.reduce((total, weight) => total + weight, 0));
    const maxVotes = Math.max(1, ...decisionRows.map((row) => row.votes || 0));
    let rowOffset = 0;
    decisionRows.forEach((item, index) => {
      const rowHeight = (topHeight - 60) * rowWeights[index] / rowWeightTotal;
      const rowY = listStartY + rowOffset;
      const prefix = decision.list.ordered ? `${index + 1}.` : '\u2022';
      pdfText(document, prefix, 70, rowY, { width: 22, fontSize: 12, bold: true, color: accent });
      pdfText(document, sentenceCaseDisplay(item.text), 94, rowY, { width: 500, height: rowHeight - 3, fontSize: 12, color: COLORS.ink });
      if (item.votes !== null) {
        document.roundedRect(615, rowY + 5, 120, 8, 4).fill('#E4E9EC');
        document.roundedRect(615, rowY + 5, 120 * item.votes / maxVotes, 8, 4).fill(accent);
        pdfText(document, String(item.votes), 745, rowY, { width: 28, fontSize: 11, bold: true, color: accent, align: 'right' });
      }
      rowOffset += rowHeight;
    });

    drawCard(48, bottomY, 745, bottomHeight);
    pdfText(document, (decision.choice.label || '').toUpperCase(), 68, bottomY + 16, { width: 690, fontSize: 9.5, bold: true, color: accent, characterSpacing: 0.5 });
    pdfText(document, sentenceCaseDisplay(decision.choice.text), 68, bottomY + 44, { width: 690, height: bottomHeight - 58, fontSize: 18, bold: true, color: COLORS.ink });
    return;
  }
  if (page.blocks.length > 1 && page.blocks.every((block) => block.kind === 'contrast')) {
    const contrasts = page.blocks.filter(
      (block): block is Extract<ReportBlock, { kind: 'contrast' }> => block.kind === 'contrast',
    );
    const startY = page.subtitle ? 161 : 145;
    const availableHeight = 400;
    const gap = 8;
    const contentHeight = availableHeight - gap * Math.max(contrasts.length - 1, 0);
    const baseHeights = contrasts.map((block) => 31 + 16 * estimateContrastLineCount(block));
    const baseHeightTotal = baseHeights.reduce((total, height) => total + height, 0);
    const extraHeight = Math.max(0, (contentHeight - baseHeightTotal) / contrasts.length);
    let rowOffset = 0;
    contrasts.forEach((block, index) => {
      const rowHeight = baseHeights[index] + extraHeight;
      const y = startY + rowOffset;
      const attackX = 190;
      const defenseX = 495;
      document.roundedRect(48, y, 745, rowHeight, 8).fill(COLORS.light);
      document.rect(48, y, 5, rowHeight).fill('#D45C53');
      pdfText(document, `${block.fromTeam} \u2192 ${block.toTeam}`, 68, y + 10, {
        width: 105, fontSize: 9.5, bold: true, color: COLORS.ink,
      });
      pdfText(document, 'ATAQUE', attackX, y + 9, {
        width: 58, fontSize: 8.5, bold: true, color: '#D45C53', characterSpacing: 0.4,
      });
      if (block.attackRecordedAt) pdfText(document, block.attackRecordedAt, attackX + 60, y + 9, {
        width: 225, fontSize: 7.5, color: COLORS.muted, align: 'right',
      });
      pdfText(document, sentenceCaseDisplay(block.attack), attackX, y + 25, {
        width: 285, height: rowHeight - 31, fontSize: 12, color: COLORS.ink,
      });
      document.rect(485, y + 10, 1, Math.max(20, rowHeight - 20)).fill('#DDE3E6');
      if (block.defense) {
        pdfText(document, 'DEFENSA / MITIGACIÓN', defenseX, y + 9, {
          width: 112, fontSize: 8.2, bold: true, color: '#3D8A69', characterSpacing: 0.25,
        });
        if (block.defenseRecordedAt) pdfText(document, block.defenseRecordedAt, defenseX + 114, y + 9, {
          width: 170, fontSize: 7.5, color: COLORS.muted, align: 'right',
        });
        pdfText(document, sentenceCaseDisplay(block.defense), defenseX, y + 25, {
          width: 278, height: rowHeight - 31, fontSize: 12, color: COLORS.ink,
        });
      }
      rowOffset += rowHeight + gap;
    });
    return;
  }

  if (page.blocks.length === 1 && page.blocks[0].kind === 'contrast') {
    const block = page.blocks[0];
    const cardY = 166;
    const cardWidth = block.defense ? 356 : 745;
    const cardHeight = 340;
    const drawSide = (x: number, title: string, body: string, color: string, timestamp?: string) => {
      document.roundedRect(x, cardY, cardWidth, cardHeight, 12).fill(COLORS.light);
      document.rect(x, cardY, 6, cardHeight).fill(color);
      pdfText(document, title, x + 22, cardY + 23, { width: cardWidth - 44, fontSize: 13, bold: true, color });
      pdfText(document, sentenceCaseDisplay(body), x + 22, cardY + 61, {
        width: cardWidth - 44, height: 232, fontSize: 12, color: COLORS.ink,
      });
      if (timestamp) pdfText(document, timestamp, x + 22, cardY + 303, {
        width: cardWidth - 44, fontSize: 9, color: COLORS.muted,
      });
    };
    drawSide(48, `ATAQUE · ${block.fromTeam}`, block.attack, '#D45C53', block.attackRecordedAt);
    if (block.defense) {
      drawSide(437, `DEFENSA / MITIGACIÓN · ${block.toTeam}`, block.defense, '#3D8A69', block.defenseRecordedAt);
    }
    return;
  }

  if ((page.kind === 'technical' || page.kind === 'index')
    && page.blocks.every((block) => block.kind === 'text')) {
    const columns = 2;
    const rows = Math.ceil(page.blocks.length / columns);
    const gapX = 18;
    const gapY = 12;
    const width = (745 - gapX) / columns;
    const height = Math.min(96, (390 - gapY * Math.max(rows - 1, 0)) / Math.max(rows, 1));
    page.blocks.forEach((block, index) => {
      if (block.kind !== 'text') return;
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = 48 + column * (width + gapX);
      const y = 156 + row * (height + gapY);
      document.roundedRect(x, y, width, height, 8).fill(COLORS.light);
      pdfText(document, block.label || '', x + 14, y + 12, {
        width: width - 28, fontSize: 9.5, bold: true, color: COLORS.purple,
      });
      pdfText(document, sentenceCaseDisplay(block.text), x + 14, y + 34, {
        width: width - 28, height: height - 44, fontSize: 12, color: COLORS.ink,
      });
    });
    return;
  }

  const startY = page.subtitle ? 161 : 145;
  const availableHeight = 400;
  const gap = 12;
  const blockHeight = Math.max(62, (availableHeight - gap * Math.max(page.blocks.length - 1, 0)) / Math.max(page.blocks.length, 1));
  page.blocks.forEach((block, index) => {
    const y = startY + index * (blockHeight + gap);
    if (block.kind === 'metrics' || block.kind === 'contrast') return;
    const accent = block.accent || (page.kind === 'editorial' ? '#C58B24' : COLORS.purple);
    document.roundedRect(48, y, 745, blockHeight, 9).fill(page.kind === 'editorial' ? COLORS.editorial : COLORS.light);
    document.rect(48, y, 5, blockHeight).fill(accent);
    if (block.kind === 'text') {
      if (block.label) pdfText(document, block.label.toUpperCase(), 68, y + 14, {
        width: 690, fontSize: 9.5, bold: true, color: accent, characterSpacing: 0.5,
      });
      pdfText(document, sentenceCaseDisplay(block.text), 68, y + (block.label ? 35 : 17), {
        width: 690, height: blockHeight - (block.label ? 47 : 30), fontSize: block.prominent ? 18 : 12, bold: block.prominent, color: COLORS.ink,
      });
    } else if (block.kind === 'list') {
      if (block.label) pdfText(document, block.label.toUpperCase(), 68, y + 14, {
        width: 690, fontSize: 9.5, bold: true, color: accent,
      });
      const itemY = y + (block.label ? 36 : 17);
      const availableListHeight = blockHeight - (block.label ? 48 : 30);
      const lineWeights = block.items.map((item) => Math.max(1, Math.ceil(item.length / 72)));
      const totalLineWeight = Math.max(1, lineWeights.reduce((sum, weight) => sum + weight, 0));
      let itemOffset = 0;
      block.items.forEach((item, itemIndex) => {
        const eachHeight = availableListHeight * lineWeights[itemIndex] / totalLineWeight;
        const rowY = itemY + itemOffset;
        const prefix = block.ordered ? `${itemIndex + 1}.` : '•';
        pdfText(document, prefix, 70, rowY, { width: 22, fontSize: 12, bold: true, color: accent });
        pdfText(document, sentenceCaseDisplay(item), 94, rowY, {
          width: 660, height: eachHeight - 2, fontSize: 12, color: COLORS.ink,
        });
        itemOffset += eachHeight;
      });
    } else if (block.kind === 'votes') {
      pdfText(document, block.label.toUpperCase(), 68, y + 14, { width: 690, fontSize: 9.5, bold: true, color: accent });
      const maxVotes = Math.max(1, ...block.items.map((item) => item.votes || 0));
      const eachHeight = Math.max(23, (blockHeight - 48) / Math.max(block.items.length, 1));
      block.items.forEach((item, itemIndex) => {
        const rowY = y + 38 + itemIndex * eachHeight;
        pdfText(document, sentenceCaseDisplay(item.option), 68, rowY, { width: 450, height: eachHeight - 2, fontSize: 12, color: COLORS.ink });
        const votes = item.votes;
        if (votes !== null) {
          document.roundedRect(535, rowY + 2, 190, 8, 4).fill('#E4E9EC');
          document.roundedRect(535, rowY + 2, 190 * votes / maxVotes, 8, 4).fill(accent);
          pdfText(document, String(votes), 736, rowY - 2, { width: 28, fontSize: 11, bold: true, color: accent, align: 'right' });
        }
      });
    }
  });
};

const renderPdfCover = (document: PDFKit.PDFDocument, page: ReportDeckPage, assets: ReportAssets) => {
  document.rect(0, 0, PAGE.width, PAGE.height).fill('#F7F4F7');
  document.circle(704, 85, 170).fill('#E9D7E7');
  document.circle(786, 497, 118).fill('#D7EDEE');
  document.roundedRect(50, 55, 741, 485, 26).fill(COLORS.white);
  if (assets.logo) document.image(assets.logo, 82, 87, { fit: [140, 50] });
  else pdfText(document, 'KREATUM™', 82, 95, { width: 170, fontSize: 22, bold: true, color: COLORS.purple });
  pdfText(document, 'Informe de resultados KREATUM™', 82, 154, { width: 400, fontSize: 11, bold: true, color: COLORS.purple });
  const titleBox = { width: 640, height: 174 };
  const titleSize = fitPdfFontSize(document, page.title, {
    ...titleBox, maxFontSize: 39, minFontSize: 18, bold: true,
  });
  pdfText(document, page.title, 82, 188, { ...titleBox, fontSize: titleSize, bold: true, color: COLORS.ink });
  document.rect(82, 378, 112, 5).fill(COLORS.purple);
  let y = 407;
  page.blocks.forEach((block) => {
    if (block.kind !== 'text') return;
    pdfText(document, block.label || '', 82, y, { width: 170, fontSize: 10, bold: true, color: COLORS.purple });
    pdfText(document, sentenceCaseDisplay(block.text), 256, y - 3, { width: 380, fontSize: 13, bold: true, color: COLORS.ink });
    y += 42;
  });
  pdfText(document, `${page.pageNumber}/${page.totalPages}`, 690, 495, { width: 65, fontSize: 9, color: COLORS.muted, align: 'right' });
};

const renderPdfSection = (document: PDFKit.PDFDocument, page: ReportDeckPage) => {
  document.rect(0, 0, PAGE.width, PAGE.height).fill('#211741');
  document.circle(748, 72, 205).fill(COLORS.purpleDark);
  document.circle(80, 590, 145).fill('#1D5864');
  pdfText(document, 'KREATUM™', 64, 54, { width: 220, fontSize: 18, bold: true, color: COLORS.white });
  pdfText(document, page.section, 64, 178, { width: 300, fontSize: 13, bold: true, color: '#DAB7D7', characterSpacing: 1.1 });
  pdfText(document, page.title, 64, 222, { width: 650, height: 105, fontSize: 39, bold: true, color: COLORS.white });
  if (page.subtitle) pdfText(document, page.subtitle, 64, 345, { width: 630, height: 75, fontSize: 16, color: '#D6E1E6' });
  pdfText(document, `${page.pageNumber}/${page.totalPages}`, 690, 530, { width: 70, fontSize: 9, color: COLORS.white, align: 'right' });
};
const renderPdfClosing = (document: PDFKit.PDFDocument, page: ReportDeckPage) => {
  document.rect(0, 0, PAGE.width, PAGE.height).fill(COLORS.ink);
  document.circle(770, 70, 190).fill(COLORS.purpleDark);
  document.circle(74, 560, 150).fill('#1D5864');
  pdfText(document, 'KREATUM™', 75, 83, { width: 190, fontSize: 22, bold: true, color: COLORS.white });
  pdfText(document, page.title, 75, 225, { width: 650, fontSize: 45, bold: true, color: COLORS.white });
  if (page.subtitle) pdfText(document, page.subtitle, 75, 302, { width: 620, fontSize: 18, color: '#D6E1E6' });
  pdfText(document, `${page.pageNumber}/${page.totalPages}`, 690, 530, { width: 70, fontSize: 9, color: COLORS.white, align: 'right' });
};

export const renderReportPdf = async (deck: ReportDeck, assets?: ReportAssets): Promise<Buffer> => {
  assets = assets ?? await loadReportAssets();
  const document = new PDFDocument({ autoFirstPage: false, size: [PAGE.width, PAGE.height], margin: 0, info: {
    Title: deck.title,
    Author: 'KREATUM™',
    Subject: 'Informe de resultados',
    Keywords: 'KREATUM™, workshop, innovación, informe',
  } });
  registerPdfFonts(document, assets);
  const completed = collectPdf(document);
  deck.pages.forEach((page) => {
    document.addPage({ size: [PAGE.width, PAGE.height], margin: 0 });
    if (page.kind === 'cover') renderPdfCover(document, page, assets);
    else if (page.kind === 'closing') renderPdfClosing(document, page);
    else if (page.kind === 'section') renderPdfSection(document, page);
    else {
      drawPdfBrand(document, page, assets);
      renderPdfBlocks(document, page);
    }
  });
  document.end();
  return completed;
};

const bufferToDataUri = (buffer: Buffer) => `data:image/png;base64,${buffer.toString('base64')}`;
const inch = (points: number) => points / 72;

const addSlideText = (
  slide: PptxGenJS.Slide,
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  options: PptxGenJS.TextPropsOptions = {},
) => slide.addText(capitalizeFirstLetter(text), {
  x, y, w, h,
  fontFace: 'Montserrat',
  color: COLORS.ink.replace('#', ''),
  margin: 0,
  breakLine: false,
  valign: 'top',
  fit: 'shrink',
  ...options,
});

const addSlideBrand = (pptx: PptxGenJS, slide: PptxGenJS.Slide, page: ReportDeckPage, assets: ReportAssets) => {
  const accent = (page.team ? TEAM_COLORS[page.team] : COLORS.purple).replace('#', '');
  slide.background = { color: COLORS.white.replace('#', '') };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: SLIDE.height, line: { transparency: 100 }, fill: { color: accent } });
  if (assets.logo) slide.addImage({ data: bufferToDataUri(assets.logo), x: 0.66, y: 0.34, w: 1.46, h: 0.48, transparency: 0 });
  else addSlideText(slide, 'KREATUM™', 0.66, 0.38, 1.9, 0.28, { fontSize: 17, bold: true, color: COLORS.purple.replace('#', '') });
  addSlideText(slide, page.section.toUpperCase(), 8.55, 0.39, 2.45, 0.22, { fontSize: 9, bold: true, color: COLORS.muted.replace('#', ''), align: 'right', charSpacing: 1.2 });
  slide.addShape(pptx.ShapeType.line, { x: 0.66, y: 0.93, w: 10.34, h: 0, line: { color: COLORS.rule.replace('#', ''), width: 1 } });
  if (page.team && assets.teams[page.team]) slide.addImage({ data: bufferToDataUri(assets.teams[page.team] as Buffer), x: 10.28, y: 1.08, w: 0.56, h: 0.56 });
  addSlideText(slide, page.title, 0.66, 1.12, page.team ? 9.35 : 10.25, 0.52, { fontSize: 29, bold: true });
  if (page.subtitle) addSlideText(slide, sentenceCaseDisplay(page.subtitle), 0.66, 1.69, 9.75, 0.42, { fontSize: 16, color: COLORS.muted.replace('#', '') });
  addSlideText(slide, `KREATUM™ · ${page.pageNumber}/${page.totalPages}`, 8.45, 7.84, 2.55, 0.2, { fontSize: 9, color: COLORS.muted.replace('#', ''), align: 'right' });
};

const addSlideBlocks = (pptx: PptxGenJS, slide: PptxGenJS.Slide, page: ReportDeckPage) => {
  if (page.blocks.length === 1 && page.blocks[0].kind === 'metrics') {
    const block = page.blocks[0];
    const width = 2.36;
    block.items.forEach((item, index) => {
      const column = index % 4;
      const row = Math.floor(index / 4);
      const x = 0.66 + column * 2.58;
      const y = 2.25 + row * 1.77;
      slide.addShape(pptx.ShapeType.roundRect, { x, y, w: width, h: 1.5, rectRadius: 0.08, line: { transparency: 100 }, fill: { color: COLORS.light.replace('#', '') } });
      addSlideText(slide, item.value, x + 0.18, y + 0.24, width - 0.36, 0.53, { fontSize: 32, bold: true, color: COLORS.purple.replace('#', '') });
      addSlideText(slide, item.label, x + 0.18, y + 0.92, width - 0.36, 0.34, { fontSize: 12, bold: true, color: COLORS.muted.replace('#', '') });
    });
    return;
  }
  const decision = getDecisionBlocks(page);
  if (decision) {
    const accent = (decision.choice.accent || decision.list.accent || COLORS.purple).replace('#', '');
    const topY = page.subtitle ? 2.22 : 2.02;
    const topHeight = 3.35;
    const gapX = 0.18;
    const columnWidth = (10.34 - gapX) / 2;
    const bottomY = topY + topHeight + 0.16;
    const bottomHeight = 1.54;
    const decisionRows = getDecisionRows(decision);
    const drawCard = (x: number, y: number, width: number, height: number) => {
      slide.addShape(pptx.ShapeType.roundRect, { x, y, w: width, h: height, rectRadius: 0.06, line: { transparency: 100 }, fill: { color: COLORS.light.replace('#', '') } });
      slide.addShape(pptx.ShapeType.rect, { x, y, w: 0.07, h: height, line: { transparency: 100 }, fill: { color: accent } });
    };

    drawCard(0.66, topY, 10.34, topHeight);
    addSlideText(slide, (decision.list.label || 'Preselección').toUpperCase(), 0.95, topY + 0.18, columnWidth - 0.55, 0.2, { fontSize: 9, bold: true, color: accent });
    const listStartY = topY + 0.58;
    addSlideText(slide, decision.votes.label.toUpperCase(), 8.65, topY + 0.18, 1.9, 0.2, { fontSize: 9, bold: true, color: accent, align: 'right' });
    const rowWeights = decisionRows.map((item) => Math.max(1, Math.ceil(item.text.length / 70)));
    const rowWeightTotal = Math.max(1, rowWeights.reduce((total, weight) => total + weight, 0));
    const maxVotes = Math.max(1, ...decisionRows.map((row) => row.votes || 0));
    let rowOffset = 0;
    decisionRows.forEach((item, index) => {
      const rowHeight = (topHeight - 0.76) * rowWeights[index] / rowWeightTotal;
      const rowY = listStartY + rowOffset;
      const prefix = decision.list.ordered ? `${index + 1}.` : '\u2022';
      addSlideText(slide, prefix, 0.97, rowY, 0.28, rowHeight - 0.03, { fontSize: 16, bold: true, color: accent });
      addSlideText(slide, sentenceCaseDisplay(item.text), 1.28, rowY, 7.0, rowHeight - 0.03, { fontSize: 16, breakLine: true, fit: 'shrink' });
      if (item.votes !== null) {
        slide.addShape(pptx.ShapeType.roundRect, { x: 8.65, y: rowY + 0.12, w: 1.55, h: 0.11, rectRadius: 0.04, line: { transparency: 100 }, fill: { color: 'E4E9EC' } });
        slide.addShape(pptx.ShapeType.roundRect, { x: 8.65, y: rowY + 0.12, w: 1.55 * item.votes / maxVotes, h: 0.11, rectRadius: 0.04, line: { transparency: 100 }, fill: { color: accent } });
        addSlideText(slide, String(item.votes), 10.32, rowY + 0.02, 0.28, 0.2, { fontSize: 11, bold: true, color: accent, align: 'right' });
      }
      rowOffset += rowHeight;
    });

    drawCard(0.66, bottomY, 10.34, bottomHeight);
    addSlideText(slide, (decision.choice.label || '').toUpperCase(), 0.95, bottomY + 0.18, 9.55, 0.2, { fontSize: 9, bold: true, color: accent, charSpacing: 0.7 });
    addSlideText(slide, sentenceCaseDisplay(decision.choice.text), 0.95, bottomY + 0.5, 9.55, bottomHeight - 0.68, { fontSize: 22, bold: true, breakLine: true });
    return;
  }
  if (page.blocks.length > 1 && page.blocks.every((block) => block.kind === 'contrast')) {
    const contrasts = page.blocks.filter(
      (block): block is Extract<ReportBlock, { kind: 'contrast' }> => block.kind === 'contrast',
    );
    const startY = page.subtitle ? 2.22 : 2.02;
    const availableHeight = 5.24;
    const gap = 0.11;
    const contentHeight = availableHeight - gap * Math.max(contrasts.length - 1, 0);
    const baseHeights = contrasts.map((block) => (31 + 16 * estimateContrastLineCount(block)) / 72);
    const baseHeightTotal = baseHeights.reduce((total, height) => total + height, 0);
    const extraHeight = Math.max(0, (contentHeight - baseHeightTotal) / contrasts.length);
    let rowOffset = 0;
    contrasts.forEach((block, index) => {
      const rowHeight = baseHeights[index] + extraHeight;
      const y = startY + rowOffset;
      slide.addShape(pptx.ShapeType.roundRect, { x: 0.66, y, w: 10.34, h: rowHeight, rectRadius: 0.05, line: { transparency: 100 }, fill: { color: COLORS.light.replace('#', '') } });
      slide.addShape(pptx.ShapeType.rect, { x: 0.66, y, w: 0.07, h: rowHeight, line: { transparency: 100 }, fill: { color: 'D45C53' } });
      addSlideText(slide, `${block.fromTeam} \u2192 ${block.toTeam}`, 0.95, y + 0.15, 1.35, 0.24, { fontSize: 10, bold: true });
      addSlideText(slide, 'ATAQUE', 2.38, y + 0.13, 0.7, 0.18, { fontSize: 8, bold: true, color: 'D45C53', charSpacing: 0.5 });
      if (block.attackRecordedAt) addSlideText(slide, block.attackRecordedAt, 3.1, y + 0.13, 2.25, 0.18, { fontSize: 7, color: COLORS.muted.replace('#', ''), align: 'right' });
      addSlideText(slide, sentenceCaseDisplay(block.attack), 2.38, y + 0.36, 3.92, rowHeight - 0.45, {
        fontSize: 16, fit: 'shrink', breakLine: true, valign: 'top',
      });
      slide.addShape(pptx.ShapeType.line, { x: 6.47, y: y + 0.13, w: 0, h: Math.max(0.25, rowHeight - 0.26), line: { color: 'DDE3E6', width: 1 } });
      if (block.defense) {
        addSlideText(slide, 'DEFENSA / MITIGACIÓN', 6.68, y + 0.13, 1.52, 0.18, { fontSize: 8, bold: true, color: '3D8A69', charSpacing: 0.3 });
        if (block.defenseRecordedAt) addSlideText(slide, block.defenseRecordedAt, 8.23, y + 0.13, 2.22, 0.18, { fontSize: 7, color: COLORS.muted.replace('#', ''), align: 'right' });
        addSlideText(slide, sentenceCaseDisplay(block.defense), 6.68, y + 0.36, 3.87, rowHeight - 0.45, {
          fontSize: 16, fit: 'shrink', breakLine: true, valign: 'top',
        });
      }
      rowOffset += rowHeight + gap;
    });
    return;
  }

  if (page.blocks.length === 1 && page.blocks[0].kind === 'contrast') {
    const block = page.blocks[0];
    const cardWidth = block.defense ? 4.95 : 10.34;
    const addSide = (x: number, title: string, body: string, color: string, timestamp?: string) => {
      slide.addShape(pptx.ShapeType.roundRect, { x, y: 2.25, w: cardWidth, h: 4.72, rectRadius: 0.08, line: { transparency: 100 }, fill: { color: COLORS.light.replace('#', '') } });
      slide.addShape(pptx.ShapeType.rect, { x, y: 2.25, w: 0.08, h: 4.72, line: { transparency: 100 }, fill: { color: color.replace('#', '') } });
      addSlideText(slide, title, x + 0.3, 2.55, cardWidth - 0.65, 0.28, { fontSize: 14, bold: true, color: color.replace('#', '') });
      addSlideText(slide, sentenceCaseDisplay(body), x + 0.3, 3.08, cardWidth - 0.65, 3.12, { fontSize: 16, breakLine: true, valign: 'top', fit: 'shrink' });
      if (timestamp) addSlideText(slide, timestamp, x + 0.3, 6.58, cardWidth - 0.65, 0.2, { fontSize: 9, color: COLORS.muted.replace('#', '') });
    };
    addSide(0.66, `ATAQUE · ${block.fromTeam}`, block.attack, '#D45C53', block.attackRecordedAt);
    if (block.defense) {
      addSide(6.05, `DEFENSA / MITIGACIÓN · ${block.toTeam}`, block.defense, '#3D8A69', block.defenseRecordedAt);
    }
    return;
  }
  if ((page.kind === 'technical' || page.kind === 'index')
    && page.blocks.every((block) => block.kind === 'text')) {
    const columns = 2;
    const rows = Math.ceil(page.blocks.length / columns);
    const gapX = 0.24;
    const gapY = 0.16;
    const width = (10.34 - gapX) / columns;
    const height = Math.min(1.25, (5.15 - gapY * Math.max(rows - 1, 0)) / Math.max(rows, 1));
    page.blocks.forEach((block, index) => {
      if (block.kind !== 'text') return;
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = 0.66 + column * (width + gapX);
      const y = 2.17 + row * (height + gapY);
      slide.addShape(pptx.ShapeType.roundRect, {
        x, y, w: width, h: height, rectRadius: 0.05,
        line: { transparency: 100 }, fill: { color: COLORS.light.replace('#', '') },
      });
      addSlideText(slide, block.label || '', x + 0.2, y + 0.16, width - 0.4, 0.2, {
        fontSize: 9, bold: true, color: COLORS.purple.replace('#', ''),
      });
      addSlideText(slide, sentenceCaseDisplay(block.text), x + 0.2, y + 0.45, width - 0.4, height - 0.58, {
        fontSize: 16, fit: 'shrink', breakLine: true,
      });
    });
    return;
  }

  const startY = page.subtitle ? 2.22 : 2.02;
  const available = 5.24;
  const gap = 0.16;
  const height = Math.max(0.82, (available - gap * Math.max(page.blocks.length - 1, 0)) / Math.max(page.blocks.length, 1));
  page.blocks.forEach((block, index) => {
    if (block.kind === 'metrics' || block.kind === 'contrast') return;
    const y = startY + index * (height + gap);
    const accent = (block.accent || (page.kind === 'editorial' ? '#C58B24' : COLORS.purple)).replace('#', '');
    slide.addShape(pptx.ShapeType.roundRect, { x: 0.66, y, w: 10.34, h: height, rectRadius: 0.06, line: { transparency: 100 }, fill: { color: (page.kind === 'editorial' ? COLORS.editorial : COLORS.light).replace('#', '') } });
    slide.addShape(pptx.ShapeType.rect, { x: 0.66, y, w: 0.07, h: height, line: { transparency: 100 }, fill: { color: accent } });
    if (block.kind === 'text') {
      if (block.label) addSlideText(slide, block.label.toUpperCase(), 0.95, y + 0.16, 9.55, 0.18, { fontSize: 9, bold: true, color: accent, charSpacing: 0.7 });
      addSlideText(slide, sentenceCaseDisplay(block.text), 0.95, y + (block.label ? 0.46 : 0.21), 9.55, height - (block.label ? 0.59 : 0.35), { fontSize: block.prominent ? 24 : 16, bold: block.prominent, fit: 'shrink', breakLine: true });
    } else if (block.kind === 'list') {
      if (block.label) addSlideText(slide, block.label.toUpperCase(), 0.95, y + 0.16, 9.55, 0.18, { fontSize: 9, bold: true, color: accent });
      const rows = block.items.map((item, itemIndex) => ({
        text: `${block.ordered ? `${itemIndex + 1}.` : '•'} ${sentenceCaseDisplay(item)}`,
        options: { bullet: false, breakLine: itemIndex < block.items.length - 1 },
      }));
      slide.addText(rows, { x: 0.95, y: y + (block.label ? 0.45 : 0.2), w: 9.55, h: height - (block.label ? 0.58 : 0.33), fontFace: 'Montserrat', fontSize: 16, color: COLORS.ink.replace('#', ''), margin: 0, breakLine: true, fit: 'shrink', paraSpaceAfter: 8 });
    } else if (block.kind === 'votes') {
      addSlideText(slide, block.label.toUpperCase(), 0.95, y + 0.16, 9.55, 0.18, { fontSize: 9, bold: true, color: accent });
      const maxVotes = Math.max(1, ...block.items.map((item) => item.votes || 0));
      const eachHeight = Math.max(0.32, (height - 0.58) / Math.max(block.items.length, 1));
      block.items.forEach((item, itemIndex) => {
        const rowY = y + 0.48 + itemIndex * eachHeight;
        addSlideText(slide, sentenceCaseDisplay(item.option), 0.95, rowY, 6.15, eachHeight - 0.03, { fontSize: 14, fit: 'shrink' });
        if (item.votes !== null) {
          slide.addShape(pptx.ShapeType.roundRect, { x: 7.35, y: rowY + 0.07, w: 2.4, h: 0.11, rectRadius: 0.04, line: { transparency: 100 }, fill: { color: 'E4E9EC' } });
          slide.addShape(pptx.ShapeType.roundRect, { x: 7.35, y: rowY + 0.07, w: 2.4 * item.votes / maxVotes, h: 0.11, rectRadius: 0.04, line: { transparency: 100 }, fill: { color: accent } });
          addSlideText(slide, String(item.votes), 9.9, rowY - 0.01, 0.5, 0.2, { fontSize: 11, bold: true, color: accent, align: 'right' });
        }
      });
    }
  });
};

const addCoverSlide = (pptx: PptxGenJS, slide: PptxGenJS.Slide, page: ReportDeckPage, assets: ReportAssets) => {
  slide.background = { color: 'F7F4F7' };
  slide.addShape(pptx.ShapeType.ellipse, { x: 9.38, y: 0, w: 2.3, h: 2.3, line: { transparency: 100 }, fill: { color: 'E9D7E7' } });
  slide.addShape(pptx.ShapeType.ellipse, { x: 10.0, y: 6.55, w: 1.68, h: 1.68, line: { transparency: 100 }, fill: { color: 'D7EDEE' } });
  slide.addShape(pptx.ShapeType.roundRect, { x: 0.69, y: 0.76, w: 10.3, h: 6.73, rectRadius: 0.12, line: { transparency: 100 }, fill: { color: 'FFFFFF' }, shadow: { type: 'outer', color: 'A8A0A8', opacity: 0.15, blur: 2, angle: 45, offset: 1 } });
  if (assets.logo) slide.addImage({ data: bufferToDataUri(assets.logo), x: 1.14, y: 1.2, w: 1.95, h: 0.69 });
  else addSlideText(slide, 'KREATUM™', 1.14, 1.29, 2.35, 0.4, { fontSize: 24, bold: true, color: COLORS.purple.replace('#', '') });
  addSlideText(slide, 'Informe de resultados KREATUM™', 1.14, 2.08, 5.4, 0.26, { fontSize: 13, bold: true, color: COLORS.purple.replace('#', '') });
  addSlideText(slide, page.title, 1.14, 2.45, 8.7, 2.35, {
    fontSize: 46, bold: true, fit: 'shrink', breakLine: true,
  });
  slide.addShape(pptx.ShapeType.rect, { x: 1.14, y: 4.95, w: 1.5, h: 0.07, line: { transparency: 100 }, fill: { color: COLORS.purple.replace('#', '') } });
  let y = 5.28;
  page.blocks.forEach((block) => {
    if (block.kind !== 'text') return;
    addSlideText(slide, block.label || '', 1.14, y, 2.25, 0.22, { fontSize: 11, bold: true, color: COLORS.purple.replace('#', '') });
    addSlideText(slide, sentenceCaseDisplay(block.text), 3.45, y - 0.03, 4.7, 0.34, { fontSize: 16, bold: true });
    y += 0.6;
  });
  addSlideText(slide, `${page.pageNumber}/${page.totalPages}`, 9.4, 6.88, 1.1, 0.2, { fontSize: 9, color: COLORS.muted.replace('#', ''), align: 'right' });
};

const addSectionSlide = (pptx: PptxGenJS, slide: PptxGenJS.Slide, page: ReportDeckPage) => {
  slide.background = { color: '211741' };
  slide.addShape(pptx.ShapeType.ellipse, { x: 9.05, y: 0, w: 2.85, h: 2.85, line: { transparency: 100 }, fill: { color: COLORS.purpleDark.replace('#', '') } });
  slide.addShape(pptx.ShapeType.ellipse, { x: 0, y: 6.33, w: 2.0, h: 2.0, line: { transparency: 100 }, fill: { color: '1D5864' } });
  addSlideText(slide, 'KREATUM™', 0.9, 0.72, 2.5, 0.36, { fontSize: 22, bold: true, color: 'FFFFFF' });
  addSlideText(slide, page.section, 0.9, 2.32, 4.0, 0.28, { fontSize: 15, bold: true, color: 'DAB7D7', charSpacing: 1.1 });
  addSlideText(slide, page.title, 0.9, 3.0, 9.2, 1.12, { fontSize: 44, bold: true, color: 'FFFFFF' });
  if (page.subtitle) addSlideText(slide, page.subtitle, 0.9, 4.62, 8.9, 0.75, { fontSize: 19, color: 'D6E1E6' });
  addSlideText(slide, `${page.pageNumber}/${page.totalPages}`, 9.6, 7.35, 1.2, 0.2, { fontSize: 9, color: 'FFFFFF', align: 'right' });
};
const addClosingSlide = (pptx: PptxGenJS, slide: PptxGenJS.Slide, page: ReportDeckPage) => {
  slide.background = { color: COLORS.ink.replace('#', '') };
  slide.addShape(pptx.ShapeType.ellipse, { x: 9.18, y: 0, w: 2.5, h: 2.5, line: { transparency: 100 }, fill: { color: COLORS.purpleDark.replace('#', '') } });
  slide.addShape(pptx.ShapeType.ellipse, { x: 0, y: 6.38, w: 1.88, h: 1.88, line: { transparency: 100 }, fill: { color: '1D5864' } });
  addSlideText(slide, 'KREATUM™', 1.05, 1.12, 2.5, 0.4, { fontSize: 24, bold: true, color: 'FFFFFF' });
  addSlideText(slide, page.title, 1.05, 3.03, 8.95, 0.92, { fontSize: 48, bold: true, color: 'FFFFFF' });
  if (page.subtitle) addSlideText(slide, page.subtitle, 1.05, 4.18, 8.7, 0.63, { fontSize: 20, color: 'D6E1E6' });
  addSlideText(slide, `${page.pageNumber}/${page.totalPages}`, 9.6, 7.35, 1.2, 0.2, { fontSize: 9, color: 'FFFFFF', align: 'right' });
};

export const renderReportPptx = async (deck: ReportDeck, assets?: ReportAssets): Promise<Buffer> => {
  assets = assets ?? await loadReportAssets();
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'KREATUM_A4_LANDSCAPE', width: SLIDE.width, height: SLIDE.height });
  pptx.layout = 'KREATUM_A4_LANDSCAPE';
  pptx.author = 'KREATUM™';
  pptx.company = 'KREATUM™';
  pptx.subject = 'Informe de resultados';
  pptx.title = deck.title;
  pptx.theme = {
    headFontFace: 'Montserrat',
    bodyFontFace: 'Montserrat',
  };
  pptx.defineSlideMaster({
    title: 'KREATUM_BLANK',
    background: { color: 'FFFFFF' },
    objects: [],
  });
  deck.pages.forEach((page) => {
    const slide = pptx.addSlide('KREATUM_BLANK');
    slide.addNotes(`Sección: ${page.section}. Página ${page.pageNumber} de ${page.totalPages}.`);
    if (page.kind === 'cover') addCoverSlide(pptx, slide, page, assets);
    else if (page.kind === 'closing') addClosingSlide(pptx, slide, page);
    else if (page.kind === 'section') addSectionSlide(pptx, slide, page);
    else {
      addSlideBrand(pptx, slide, page, assets);
      addSlideBlocks(pptx, slide, page);
    }
  });
  const output = await pptx.write({ outputType: 'nodebuffer', compression: true });
  return Buffer.isBuffer(output) ? output : Buffer.from(output as ArrayBuffer);
};

export const reportPageDimensions = {
  pdf: PAGE,
  pptx: SLIDE,
  pdfPointsToInches: inch,
};
