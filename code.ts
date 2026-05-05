figma.showUI(__html__, { width: 520, height: 560 });

type StyleDef = {
  name: string;
  group: string;
  tokenGroup: string;
  family: string;
  style: string;
  fontSize: number;
  lineHeight: number;
  fontWeight: number;
  letterSpacing: number;
};

type ModeName = "mobile" | "tablet" | "desktop";

type StructuredTokenExport = {
  meta: {
    generator: string;
    kind: "tokens";
    version: string;
  };
  modes: ModeName[];
  typography: Record<
    string,
    {
      fontSize: Record<ModeName, number>;
      lineHeight: Record<ModeName, number>;
      letterSpacing: Record<ModeName, number>;
    }
  >;
};

type StructuredStyleExport = {
  meta: {
    generator: string;
    kind: "styles";
    version: string;
  };
  styles: Record<
    string,
    {
      tokenGroup: string;
      fontFamily: string;
      fontStyle: string;
      fontWeight: number;
    }
  >;
};

type CombinedExport = {
  meta: {
    generator: string;
    kind: "typeflow-export";
    version: string;
  };
  tokens: StructuredTokenExport;
  styles: StructuredStyleExport;
};

type PluginMessage = {
  type: string;
  mobileBaseFontSize?: number;
  mobileScaleRatio?: number;
  tabletBaseFontSize?: number;
  tabletScaleRatio?: number;
  desktopBaseFontSize?: number;
  desktopScaleRatio?: number;
  fontFamily?: string;
  headingWeights?: string[];
  bodyWeights?: string[];
  importJsonText?: string;
  presetName?: string;
  presetValues?: PresetValues;
};
type ImportedTypeFlowJson = {
  meta?: {
    generator?: string;
    kind?: string;
    version?: string;
  };
  tokens: {
    meta?: {
      generator?: string;
      kind?: string;
      version?: string;
    };
    modes: ModeName[];
    typography: Record<
      string,
      {
        fontSize: Record<ModeName, number>;
        lineHeight: Record<ModeName, number>;
        letterSpacing: Record<ModeName, number>;
      }
    >;
  };
  styles: {
    meta?: {
      generator?: string;
      kind?: string;
      version?: string;
    };
    styles: Record<
      string,
      {
        tokenGroup: string;
        fontFamily: string;
        fontStyle: string;
        fontWeight: number;
      }
    >;
  };
};

type PresetValues = {
  mobileBaseFontSize: number;
  mobileScaleRatio: number;
  tabletBaseFontSize: number;
  tabletScaleRatio: number;
  desktopBaseFontSize: number;
  desktopScaleRatio: number;
  fontFamily: string;
  headingWeights: string[];
  bodyWeights: string[];
};

const PRESET_STORAGE_KEY = "typeflow-presets";

const VARIABLE_COLLECTION_NAME = "TypeFlow Typography";
const PREVIEW_FRAME_ID_KEY = "typeflow-preview-frame-id";

function sendLog(message: string) {
  figma.ui.postMessage({
    type: "log",
    message,
  });
}

function toTokenName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\//g, "-")
    .replace(/\s+/g, "-");
}

function debugCollections() {
  const collections = figma.variables.getLocalVariableCollections();

  const lines = collections.map((c, index) => {
    return `[${index}] name="${c.name}" id="${c.id}" modes=${c.modes
      .map((m) => m.name)
      .join(", ")}`;
  });

  sendLog(
    [
      `Local Variable Collections: ${collections.length}`,
      ...lines,
    ].join("\n")
  );
}

function normalizeFontStyleKey(style: string): string {
  return style.replace(/[\s_-]/g, "").toLowerCase();
}

function getFontStyleCandidates(targetStyle: string): string[] {
  const normalized = normalizeFontStyleKey(targetStyle);

  const aliasMap: Record<string, string[]> = {
    thin: ["Thin", "ExtraLight", "Light", "Regular"],
    extralight: ["ExtraLight", "Light", "Regular", "Medium"],
    ultralight: ["UltraLight", "Light", "Regular", "Medium"],
    light: ["Light", "Regular", "Medium"],
    regular: ["Regular", "Book", "Normal", "Medium", "SemiBold", "Bold"],
    book: ["Book", "Regular", "Normal", "Medium"],
    normal: ["Normal", "Regular", "Book", "Medium"],
    medium: ["Medium", "Regular", "SemiBold", "Bold"],
    semibold: ["SemiBold", "Semibold", "DemiBold", "Medium", "Bold", "Regular"],
    demibold: ["DemiBold", "SemiBold", "Semibold", "Medium", "Bold", "Regular"],
    bold: ["Bold", "SemiBold", "Semibold", "DemiBold", "Medium", "Regular"],
    extrabold: ["ExtraBold", "Bold", "SemiBold", "Medium"],
    black: ["Black", "ExtraBold", "Bold", "SemiBold"],
  };

  const rawCandidates = aliasMap[normalized] ?? [targetStyle, "Regular", "Medium", "SemiBold", "Bold"];

  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const candidate of [targetStyle, ...rawCandidates]) {
    const key = normalizeFontStyleKey(candidate);
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(candidate);
    }
  }

  return candidates;
}

async function loadFontSafe(
  family: string,
  targetStyle: string
): Promise<FontName> {
  const fonts = await figma.listAvailableFontsAsync();
  const normalizedTarget = normalizeFontStyleKey(targetStyle);

  const match = fonts.find((f) => {
    return (
      f.fontName.family === family &&
      normalizeFontStyleKey(f.fontName.style) === normalizedTarget
    );
  });

  if (!match) {
    throw new Error(`Font not found: ${family} ${targetStyle}`);
  }

  await figma.loadFontAsync(match.fontName);
  return match.fontName;
}

async function loadFontWithFallback(
  family: string,
  targetStyle: string
): Promise<FontName> {
  const fonts = await figma.listAvailableFontsAsync();
  const familyFallbacks = Array.from(new Set([family, "Inter", "Roboto"]));
  const styleCandidates = getFontStyleCandidates(targetStyle);
  const requestedStyleKey = normalizeFontStyleKey(targetStyle);

  for (const fam of familyFallbacks) {
    const familyFonts = fonts.filter((f) => f.fontName.family === fam);
    if (familyFonts.length === 0) continue;

    for (const candidate of styleCandidates) {
      const candidateKey = normalizeFontStyleKey(candidate);

      const match = familyFonts.find((f) => {
        return normalizeFontStyleKey(f.fontName.style) === candidateKey;
      });

      if (!match) continue;

      await figma.loadFontAsync(match.fontName);

      const usedDifferentFamily = fam !== family;
      const usedDifferentStyle =
        normalizeFontStyleKey(match.fontName.style) !== requestedStyleKey;

      if (usedDifferentFamily || usedDifferentStyle) {
        sendLog(
          `⚠️ Font fallback used: requested ${family} ${targetStyle} → using ${match.fontName.family} ${match.fontName.style}`
        );
      }

      return match.fontName;
    }

    const regularish = familyFonts.find((f) => {
      return ["regular", "book", "normal"].includes(
        normalizeFontStyleKey(f.fontName.style)
      );
    });

    if (regularish) {
      await figma.loadFontAsync(regularish.fontName);
      sendLog(
        `⚠️ Font fallback used: requested ${family} ${targetStyle} → using ${regularish.fontName.family} ${regularish.fontName.style}`
      );
      return regularish.fontName;
    }

    await figma.loadFontAsync(familyFonts[0].fontName);
    sendLog(
      `⚠️ Font fallback used: requested ${family} ${targetStyle} → using ${familyFonts[0].fontName.family} ${familyFonts[0].fontName.style}`
    );
    return familyFonts[0].fontName;
  }

  throw new Error(`No usable font found for ${family} ${targetStyle}`);
}

function removeExistingStyleByName(name: string) {
  const styles = figma.getLocalTextStyles();
  const existing = styles.find((style) => style.name === name);
  if (existing) {
    existing.remove();
  }
}

async function getVariableCollectionByName(
  name: string
): Promise<VariableCollection> {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const collection = collections.find((c) => c.name === name);

  if (!collection) {
    throw new Error(`Variable collection not found: ${name}`);
  }

  return collection;
}

function getVariablesInCollection(collection: VariableCollection): Variable[] {
  return collection.variableIds
    .map((id) => figma.variables.getVariableById(id))
    .filter((v): v is Variable => v !== null);
}

async function ensureVariableCollection(
  name: string
): Promise<VariableCollection> {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const existing = collections.find((c) => c.name === name);

  if (existing) return existing;

  return figma.variables.createVariableCollection(name);
}

function ensureMode(collection: VariableCollection, modeName: string): string {
  const existing = collection.modes.find(
    (mode) => mode.name.toLowerCase() === modeName.toLowerCase()
  );

  if (existing) return existing.modeId;

  return collection.addMode(modeName);
}

function ensureBaseModes(collection: VariableCollection) {
  const findMode = (name: string) =>
    collection.modes.find((m) => m.name.toLowerCase() === name.toLowerCase());

  const defaultLikeMode = collection.modes.find((m) => m.name === "Mode 1");
  const mobileMode = findMode("mobile");

  if (collection.modes.length === 1 && defaultLikeMode) {
    collection.renameMode(defaultLikeMode.modeId, "mobile");
    ensureMode(collection, "tablet");
    ensureMode(collection, "desktop");
    return;
  }

  if (defaultLikeMode && mobileMode) {
    collection.removeMode(defaultLikeMode.modeId);
  }

  ensureMode(collection, "mobile");
  ensureMode(collection, "tablet");
  ensureMode(collection, "desktop");

  const refreshedMobile = findMode("mobile");
  const refreshedTablet = findMode("tablet");
  const refreshedDesktop = findMode("desktop");

  if (!refreshedMobile) throw new Error("Failed to ensure mobile mode");
  if (!refreshedTablet) throw new Error("Failed to ensure tablet mode");
  if (!refreshedDesktop) throw new Error("Failed to ensure desktop mode");
}

function ensureNumberVariable(
  collection: VariableCollection,
  variableName: string
): Variable {
  const existing = collection.variableIds
    .map((id) => figma.variables.getVariableById(id))
    .find((v): v is Variable => v !== null && v.name === variableName);

  if (existing) return existing;

  return figma.variables.createVariable(variableName, collection, "FLOAT");
}

async function ensureTypographyStructure(): Promise<{
  collection: VariableCollection;
  variables: Variable[];
}> {
  const collection = await ensureVariableCollection(VARIABLE_COLLECTION_NAME);

  ensureBaseModes(collection);

  const groups = [
    "h1",
    "h2",
    "h3",
    "h4",
    "body-large",
    "body-medium",
    "body-small",
    "caption",
  ];

  const fields = [
    "font-size",
    "line-height",
    "font-weight",
    "letter-spacing",
  ];

  for (const group of groups) {
    for (const field of fields) {
      ensureNumberVariable(collection, `${group}/${field}`);
    }
  }

  const variables = getVariablesInCollection(collection);
  return { collection, variables };
}

function findVariable(
  variables: Variable[],
  variableName: string
): Variable | null {
  return variables.find((v) => v.name === variableName) ?? null;
}

function bindStyleToVariables(
  style: TextStyle,
  group: string,
  variables: Variable[]
) {
  const fontSizeVar = findVariable(variables, `${group}/font-size`);
  const lineHeightVar = findVariable(variables, `${group}/line-height`);
  const letterSpacingVar = findVariable(variables, `${group}/letter-spacing`);

  const missing: string[] = [];

  if (!fontSizeVar) missing.push(`${group}/font-size`);
  if (!lineHeightVar) missing.push(`${group}/line-height`);
  if (!letterSpacingVar) missing.push(`${group}/letter-spacing`);

  if (missing.length > 0) {
    throw new Error(`Missing variables: ${missing.join(", ")}`);
  }

  style.setBoundVariable("fontSize", fontSizeVar);
  style.setBoundVariable("lineHeight", lineHeightVar);
  style.setBoundVariable("letterSpacing", letterSpacingVar);
}

function roundToInt(value: number): number {
  return Math.round(value);
}
function snapTo4(value: number): number {
  return Math.ceil(value / 4) * 4;
}

function calcLineHeight(
  size: number,
  type: "heading" | "body" | "caption"
): number {
  let raw = 0;

  if (type === "heading") {
    raw = size * 1.2;
  } else if (type === "body") {
    raw = size * 1.5;
  } else {
    raw = size * 1.4;
  }

  return snapTo4(raw);
}

function calcLetterSpacing(
  size: number,
  type:
    | "h1"
    | "h2"
    | "h3"
    | "h4"
    | "body-large"
    | "body-medium"
    | "body-small"
    | "caption"
): number {
  let em = 0;

  if (type === "h1") em = -0.025;
  else if (type === "h2") em = -0.022;
  else if (type === "h3") em = -0.018;
  else if (type === "h4") em = -0.012;
  else if (type === "body-large") em = -0.002;
  else if (type === "body-medium") em = 0;
  else if (type === "body-small") em = 0.002;
  else if (type === "caption") em = 0.006;

  return Math.round(size * em * 100) / 100;
}

const HEADING_WEIGHTS = [
  { name: "Regular", value: 400, style: "Regular" },
  { name: "Medium", value: 500, style: "Medium" },
  { name: "SemiBold", value: 600, style: "SemiBold" },
  { name: "Bold", value: 700, style: "Bold" },
];

const BODY_WEIGHTS = [
  { name: "Regular", value: 400, style: "Regular" },
  { name: "Medium", value: 500, style: "Medium" },
];

function makeStyleDefs(
  base: number,
  ratio: number,
  fontFamily: string,
  selectedHeadingWeights: string[],
  selectedBodyWeights: string[]
): StyleDef[] {
  const pow = (exp: number) => Math.pow(ratio, exp);

  const h1 = roundToInt(base * pow(4));
  const h2 = roundToInt(base * pow(3));
  const h3 = roundToInt(base * pow(2));
  const h4 = roundToInt(base * pow(1));
  const bodyLarge = roundToInt(base * pow(0.5));
  const bodyMedium = roundToInt(base);
  const bodySmall = roundToInt(base / pow(1));
  const caption = roundToInt(base / pow(2));

  const defs: StyleDef[] = [];

  const headingSpecs = [
    { key: "h1", label: "Heading/H1", size: h1 },
    { key: "h2", label: "Heading/H2", size: h2 },
    { key: "h3", label: "Heading/H3", size: h3 },
    { key: "h4", label: "Heading/H4", size: h4 },
  ];

  const enabledHeadingWeights = HEADING_WEIGHTS.filter((weight) =>
    selectedHeadingWeights.includes(weight.name)
  );

  const enabledBodyWeights = BODY_WEIGHTS.filter((weight) =>
    selectedBodyWeights.includes(weight.name)
  );

  for (const spec of headingSpecs) {
    for (const weight of enabledHeadingWeights) {
      defs.push({
        name: `${spec.label}/${weight.name}`,
        group: `${spec.key}-${weight.name.toLowerCase()}`,
        tokenGroup: spec.key,
        family: fontFamily,
        style: weight.style,
        fontSize: spec.size,
        lineHeight: calcLineHeight(spec.size, "heading"),
        fontWeight: weight.value,
        letterSpacing: calcLetterSpacing(
          spec.size,
          spec.key as "h1" | "h2" | "h3" | "h4"
        ),
      });
    }
  }

  const bodySpecs = [
    { key: "body-large", label: "Body/Large", size: bodyLarge },
    { key: "body-medium", label: "Body/Medium", size: bodyMedium },
    { key: "body-small", label: "Body/Small", size: bodySmall },
  ];

  for (const spec of bodySpecs) {
    for (const weight of enabledBodyWeights) {
      defs.push({
        name: `${spec.label}/${weight.name}`,
        group: `${spec.key}-${weight.name.toLowerCase()}`,
        tokenGroup: spec.key,
        family: fontFamily,
        style: weight.style,
        fontSize: spec.size,
        lineHeight: calcLineHeight(spec.size, "body"),
        fontWeight: weight.value,
        letterSpacing: calcLetterSpacing(
          spec.size,
          spec.key as "body-large" | "body-medium" | "body-small"
        ),
      });
    }
  }

  if (selectedBodyWeights.includes("Regular")) {
    defs.push({
      name: "Caption/Regular",
      group: "caption-regular",
      tokenGroup: "caption",
      family: fontFamily,
      style: "Regular",
      fontSize: caption,
      lineHeight: calcLineHeight(caption, "caption"),
      fontWeight: 400,
      letterSpacing: calcLetterSpacing(caption, "caption"),
    });
  }

  if (selectedBodyWeights.includes("Medium")) {
    defs.push({
      name: "Caption/Medium",
      group: "caption-medium",
      tokenGroup: "caption",
      family: fontFamily,
      style: "Medium",
      fontSize: caption,
      lineHeight: calcLineHeight(caption, "caption"),
      fontWeight: 500,
      letterSpacing: calcLetterSpacing(caption, "caption"),
    });
  }
  
  // 👇 여기 추가
  const styleOrder = [
    "Heading/H1",
    "Heading/H2",
    "Heading/H3",
    "Heading/H4",
    "Body/Large",
    "Body/Medium",
    "Body/Small",
    "Caption",
  ];
  
  const weightOrder = ["Regular", "Medium", "SemiBold", "Bold"];
  
  defs.sort((a, b) => {
    const aParts = a.name.split("/");
    const bParts = b.name.split("/");
  
    const aBase = aParts.slice(0, -1).join("/");
    const bBase = bParts.slice(0, -1).join("/");
  
    const aWeight = aParts[aParts.length - 1];
    const bWeight = bParts[bParts.length - 1];
  
    const baseDiff =
      styleOrder.indexOf(aBase) - styleOrder.indexOf(bBase);
  
    if (baseDiff !== 0) return baseDiff;
  
    return weightOrder.indexOf(aWeight) - weightOrder.indexOf(bWeight);
  });
  
  // 👇 원래 있던 거 그대로 유지
 
  return defs;
}

function makePreviewLines(defs: StyleDef[]): string[] {
  return defs.map((def) => {
    return `${def.name} → size ${def.fontSize}, line ${def.lineHeight}, tracking ${def.letterSpacing}`;
  });
}
function buildExportData(defs: StyleDef[]) {
  const result: Record<string, {
    fontSize: number;
    lineHeight: number;
    fontWeight: number;
    letterSpacing: number;
    fontFamily: string;
    fontStyle: string;
  }> = {};

  for (const def of defs) {
    result[toTokenName(def.name)] = {
      fontSize: def.fontSize,
      lineHeight: def.lineHeight,
      fontWeight: def.fontWeight,
      letterSpacing: def.letterSpacing,
      fontFamily: def.family,
      fontStyle: def.style,
    };
  }

  return result;
}
function buildStructuredTokenExport(
  mobileDefs: StyleDef[],
  tabletDefs: StyleDef[],
  desktopDefs: StyleDef[]
): StructuredTokenExport {
  const result: StructuredTokenExport = {
    meta: {
      generator: "TypeFlow v2",
      kind: "tokens",
      version: "2.0",
    },
    modes: ["mobile", "tablet", "desktop"],
    typography: {},
  };

  const groups = Array.from(
    new Set(desktopDefs.map((def) => def.tokenGroup))
  );

  for (const group of groups) {
    const mobileDef = mobileDefs.find((def) => def.tokenGroup === group);
    const tabletDef = tabletDefs.find((def) => def.tokenGroup === group);
    const desktopDef = desktopDefs.find((def) => def.tokenGroup === group);

    if (!mobileDef || !tabletDef || !desktopDef) continue;

    result.typography[group] = {
      fontSize: {
        mobile: mobileDef.fontSize,
        tablet: tabletDef.fontSize,
        desktop: desktopDef.fontSize,
      },
      lineHeight: {
        mobile: mobileDef.lineHeight,
        tablet: tabletDef.lineHeight,
        desktop: desktopDef.lineHeight,
      },
      letterSpacing: {
        mobile: mobileDef.letterSpacing,
        tablet: tabletDef.letterSpacing,
        desktop: desktopDef.letterSpacing,
      },
    };
  }

  return result;
}

function buildStructuredStyleExport(
  defs: StyleDef[]
): StructuredStyleExport {
  const result: StructuredStyleExport = {
    meta: {
      generator: "TypeFlow v2",
      kind: "styles",
      version: "2.0",
    },
    styles: {},
  };

  for (const def of defs) {
    result.styles[def.name] = {
      tokenGroup: def.tokenGroup,
      fontFamily: def.family,
      fontStyle: def.style,
      fontWeight: def.fontWeight,
    };
  }

  return result;
}

function buildCombinedExport(
  mobileDefs: StyleDef[],
  tabletDefs: StyleDef[],
  desktopDefs: StyleDef[]
): CombinedExport {
  return {
    meta: {
      generator: "TypeFlow v2",
      kind: "typeflow-export",
      version: "2.0",
    },
    tokens: buildStructuredTokenExport(
      mobileDefs,
      tabletDefs,
      desktopDefs
    ),
    styles: buildStructuredStyleExport(desktopDefs),
  };
}


function buildCssExport(defs: StyleDef[]) {
  const lines: string[] = [":root {"];

  for (const def of defs) {
    const token = toTokenName(def.name)
     

    lines.push(`  --${token}-font-size: ${def.fontSize}px;`);
    lines.push(`  --${token}-line-height: ${def.lineHeight}px;`);
    lines.push(`  --${token}-font-weight: ${def.fontWeight};`);
    lines.push(`  --${token}-letter-spacing: ${def.letterSpacing}px;`);
  }

  lines.push("}");
  return lines.join("\n");
}

function isValidModeName(value: string): value is ModeName {
  return value === "mobile" || value === "tablet" || value === "desktop";
}

function validateImportedTypeFlowJson(data: unknown): asserts data is ImportedTypeFlowJson {
  if (!data || typeof data !== "object") {
    throw new Error("Import JSON must be an object.");
  }

  const root = data as Record<string, unknown>;

  if (!root.tokens || typeof root.tokens !== "object") {
    throw new Error("Missing tokens section.");
  }

  if (!root.styles || typeof root.styles !== "object") {
    throw new Error("Missing styles section.");
  }

  const tokens = root.tokens as Record<string, unknown>;
  const styles = root.styles as Record<string, unknown>;

  if (!Array.isArray(tokens.modes)) {
    throw new Error("tokens.modes must be an array.");
  }

  for (const mode of tokens.modes) {
    if (typeof mode !== "string" || !isValidModeName(mode)) {
      throw new Error(`Invalid mode: ${String(mode)}`);
    }
  }

  if (!tokens.typography || typeof tokens.typography !== "object") {
    throw new Error("tokens.typography must be an object.");
  }

  if (!styles.styles || typeof styles.styles !== "object") {
    throw new Error("styles.styles must be an object.");
  }
}

function setImportedValuesForModes(
  imported: ImportedTypeFlowJson,
  collection: VariableCollection,
  variables: Variable[]
) {
  const typography = imported.tokens.typography;

  for (const [group, tokenValues] of Object.entries(typography)) {
    const fontSizeVar = findVariable(variables, `${group}/font-size`);
    const lineHeightVar = findVariable(variables, `${group}/line-height`);
    const letterSpacingVar = findVariable(variables, `${group}/letter-spacing`);

    if (!fontSizeVar || !lineHeightVar || !letterSpacingVar) {
      throw new Error(`Missing variables for token group: ${group}`);
    }

    for (const mode of collection.modes) {
      const modeType = getModeType(mode.name);

      const fontSize = tokenValues.fontSize[modeType];
      const lineHeight = tokenValues.lineHeight[modeType];
      const letterSpacing = tokenValues.letterSpacing[modeType];

      if (typeof fontSize !== "number") {
        throw new Error(`Missing fontSize for ${group}.${modeType}`);
      }
      if (typeof lineHeight !== "number") {
        throw new Error(`Missing lineHeight for ${group}.${modeType}`);
      }
      if (typeof letterSpacing !== "number") {
        throw new Error(`Missing letterSpacing for ${group}.${modeType}`);
      }

      fontSizeVar.setValueForMode(mode.modeId, fontSize);
      lineHeightVar.setValueForMode(mode.modeId, lineHeight);
      letterSpacingVar.setValueForMode(mode.modeId, letterSpacing);
    }
  }
}

async function createStylesFromImportedJson(
  imported: ImportedTypeFlowJson,
  variables: Variable[]
): Promise<{ createdCount: number; errors: string[] }> {
  const errors: string[] = [];
  let createdCount = 0;

  const desktopTypography = imported.tokens.typography;
  const importedStyles = imported.styles.styles;

  for (const [styleName, styleMeta] of Object.entries(importedStyles)) {
    try {
      const tokenGroup = styleMeta.tokenGroup;
      const tokenValues = desktopTypography[tokenGroup];

      if (!tokenValues) {
        throw new Error(`Missing token values for group: ${tokenGroup}`);
      }

      const loadedFont = await loadFontWithFallback(
        styleMeta.fontFamily,
        styleMeta.fontStyle
      );

      removeExistingStyleByName(styleName);

      const style = figma.createTextStyle();
      style.name = styleName;
      style.fontName = loadedFont;
      style.fontSize = tokenValues.fontSize.desktop;
      style.lineHeight = {
        unit: "PIXELS",
        value: tokenValues.lineHeight.desktop,
      };
      style.letterSpacing = {
        unit: "PIXELS",
        value: tokenValues.letterSpacing.desktop,
      };

      bindStyleToVariables(style, tokenGroup, variables);
      createdCount += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${styleName}: ${message}`);
    }
  }

  return { createdCount, errors };
}

function sendCopyPayload(text: string) {
  figma.ui.postMessage({
    type: "copy-text",
    text,
  });
}

function getModeType(modeName: string): "mobile" | "tablet" | "desktop" {
  const normalized = modeName.toLowerCase();

  if (normalized.includes("mobile")) return "mobile";
  if (normalized.includes("tablet")) return "tablet";
  if (normalized.includes("desktop")) return "desktop";

  return "mobile";
}

function getActiveModeIdForNode(
  node: SceneNode,
  collection: VariableCollection
): string {
  return node.resolvedVariableModes[collection.id] ?? collection.defaultModeId;
}

function getVariableValue(
  variables: Variable[],
  name: string,
  modeId: string
): number | null {
  const v = variables.find((v) => v.name === name);
  if (!v) return null;

  const value = v.valuesByMode[modeId];
  return typeof value === "number" ? value : null;
}

function makeModePreviewLines(
  label: string,
  defs: StyleDef[]
): string[] {
  return [
    `${label}:`,
    ...defs.map((def) => {
      return `${def.name} → size ${def.fontSize}, line ${def.lineHeight}, tracking ${def.letterSpacing}`;
    }),
  ];
}

function findChildByRole(parent: BaseNode & ChildrenMixin, role: string) {
  return parent.children.find(
    (node) => node.getPluginData("typeflow-role") === role
  );
}

function setRole(node: SceneNode, role: string) {
  node.setPluginData("typeflow-role", role);
}

function getOrCreateSection(
  frame: FrameNode,
  role: string,
  name: string
): FrameNode {
  const existing = findChildByRole(frame, role);
  if (existing && existing.type === "FRAME") {
    return existing;
  }

  const section = figma.createFrame();
  section.name = name;
  section.layoutMode = "VERTICAL";
  section.primaryAxisSizingMode = "AUTO";
  section.counterAxisSizingMode = "FIXED";
  section.resize(820, 100);
  section.itemSpacing = 8;
  section.layoutAlign = "STRETCH";
  section.fills = [];
  setRole(section, role);
  frame.appendChild(section);
  return section;
}
function reorderPreviewSections(frame: FrameNode, defs: StyleDef[]) {
  const title = findChildByRole(frame, "preview-title");
  const subtitle = findChildByRole(frame, "preview-subtitle");

  // 제목과 서브타이틀 먼저 앞으로
  if (title && frame.children.indexOf(title as SceneNode) !== 0) {
    frame.insertChild(0, title as SceneNode);
  }

  if (subtitle) {
    const subtitleIndex = frame.children.indexOf(subtitle as SceneNode);
    if (subtitleIndex !== 1) {
      frame.insertChild(Math.min(1, frame.children.length), subtitle as SceneNode);
    }
  }

  // defs 순서대로 preview section 재정렬
  defs.forEach((def, index) => {
    const section = findChildByRole(frame, `preview-section-${def.group}`);
    if (section && section.type === "FRAME") {
      const targetIndex = index + 2; // title, subtitle 다음
      const currentIndex = frame.children.indexOf(section);
      if (currentIndex !== targetIndex) {
        frame.insertChild(targetIndex, section);
      }
    }
  });
}

function getPreviewCategory(def: StyleDef): "heading" | "body" | "caption" {
  if (def.tokenGroup.startsWith("h")) return "heading";
  if (def.tokenGroup === "caption") return "caption";
  return "body";
}

function getPreviewCategoryLabel(category: "heading" | "body" | "caption"): string {
  if (category === "heading") return "Heading";
  if (category === "body") return "Body";
  return "Caption";
}

function getSectionOrder(role: string): number {
  const order = [
    "preview-title",
    "preview-subtitle",
    "preview-group-heading",
    "preview-group-body",
    "preview-group-caption",
  ];
  const index = order.indexOf(role);
  return index === -1 ? 999 : index;
}

function reorderGroupedPreviewSections(frame: FrameNode) {
  const nodes = [...frame.children];
  nodes.sort((a, b) => {
    const aRole = a.getPluginData("typeflow-role");
    const bRole = b.getPluginData("typeflow-role");
    return getSectionOrder(aRole) - getSectionOrder(bRole);
  });

  nodes.forEach((node, index) => {
    if (frame.children[index] !== node) {
      frame.insertChild(index, node);
    }
  });
}

function formatPx(value: number | null): string {
  if (value === null) return "-";
  return `${Number(value.toFixed(2))}px`;
}

function makeModeMetaLine(
  label: string,
  fontSize: number | null,
  lineHeight: number | null,
  letterSpacing: number | null
): string {
  return `${label} ${formatPx(fontSize)} / ${formatPx(lineHeight)} / ${formatPx(letterSpacing)}`;
}

async function getOrCreateTextNode(
  parent: FrameNode,
  role: string,
  name: string,
  fallbackFont: FontName
): Promise<TextNode> {
  const existing = findChildByRole(parent, role);
  if (existing && existing.type === "TEXT") {
    const currentFont = existing.fontName;
    if (currentFont !== figma.mixed) {
      await figma.loadFontAsync(currentFont);
    } else {
      await figma.loadFontAsync(fallbackFont);
    }
    return existing;
  }

  await figma.loadFontAsync(fallbackFont);

  const text = figma.createText();
  text.name = name;
  text.fontName = fallbackFont;
  text.layoutAlign = "STRETCH";
  text.textAutoResize = "HEIGHT";
  text.resize(820, text.height);
  setRole(text, role);
  parent.appendChild(text);
  return text;
}

async function getOrCreatePreviewFrame(): Promise<FrameNode> {
  const savedId = figma.root.getPluginData(PREVIEW_FRAME_ID_KEY);

  if (savedId) {
    const existing = await figma.getNodeByIdAsync(savedId);
    if (existing && existing.type === "FRAME") {
      return existing;
    }
  }

  const frame = figma.createFrame();
  frame.name = "TypeFlow Preview";
  frame.layoutMode = "VERTICAL";
  frame.primaryAxisSizingMode = "AUTO";
  frame.counterAxisSizingMode = "FIXED";
  frame.resize(900, 400);
  frame.itemSpacing = 20;
  frame.paddingTop = 24;
  frame.paddingBottom = 24;
  frame.paddingLeft = 24;
  frame.paddingRight = 24;
  frame.cornerRadius = 16;
  frame.x = figma.viewport.center.x - 360;
  frame.y = figma.viewport.center.y - 300;
  frame.fills = [
    {
      type: "SOLID",
      color: { r: 1, g: 1, b: 1 },
    },
  ];
  frame.strokes = [
    {
      type: "SOLID",
      color: { r: 0.9, g: 0.9, b: 0.9 },
    },
  ];

  figma.currentPage.appendChild(frame);
  figma.root.setPluginData(PREVIEW_FRAME_ID_KEY, frame.id);

  return frame;
}

function updateVariablesForAllModes(
  mobileDefs: StyleDef[],
  tabletDefs: StyleDef[],
  desktopDefs: StyleDef[],
  collection: VariableCollection,
  variables: Variable[]
) {
  for (const mode of collection.modes) {
    const modeType = getModeType(mode.name);

    let defs: StyleDef[];
    if (modeType === "mobile") defs = mobileDefs;
    else if (modeType === "tablet") defs = tabletDefs;
    else defs = desktopDefs;

    for (const def of defs) {
      const fontSizeVar = findVariable(
        variables,
        `${def.tokenGroup}/font-size`
      );
      const lineHeightVar = findVariable(
        variables,
        `${def.tokenGroup}/line-height`
      );
      const letterSpacingVar = findVariable(
        variables,
        `${def.tokenGroup}/letter-spacing`
      );

      if (!fontSizeVar || !lineHeightVar || !letterSpacingVar) {
        throw new Error(`Missing variables for group: ${def.tokenGroup}`);
      }

      fontSizeVar.setValueForMode(mode.modeId, def.fontSize);
      lineHeightVar.setValueForMode(mode.modeId, def.lineHeight);
      letterSpacingVar.setValueForMode(mode.modeId, def.letterSpacing);
    }
  }
}

async function applyTokens(
  mobileBaseFontSize: number,
  mobileScaleRatio: number,
  tabletBaseFontSize: number,
  tabletScaleRatio: number,
  desktopBaseFontSize: number,
  desktopScaleRatio: number,
  fontFamily: string,
  headingWeights: string[],
  bodyWeights: string[]
) {
  const mobileDefs = makeStyleDefs(
    mobileBaseFontSize,
    mobileScaleRatio,
    fontFamily,
    headingWeights,
    bodyWeights
  );

  const tabletDefs = makeStyleDefs(
    tabletBaseFontSize,
    tabletScaleRatio,
    fontFamily,
    headingWeights,
    bodyWeights
  );

  const desktopDefs = makeStyleDefs(
    desktopBaseFontSize,
    desktopScaleRatio,
    fontFamily,
    headingWeights,
    bodyWeights
  );

  const { collection, variables } = await ensureTypographyStructure();

  updateVariablesForAllModes(mobileDefs, tabletDefs, desktopDefs, collection, variables);

  sendLog(
    [
      `Success!`,
      `Applied tokens`,
      ``,
      `Mobile: base ${mobileBaseFontSize}, ratio ${mobileScaleRatio}`,
      `Tablet: base ${tabletBaseFontSize}, ratio ${tabletScaleRatio}`,
      `Desktop: base ${desktopBaseFontSize}, ratio ${desktopScaleRatio}`,
      `Updated variables in ${collection.modes.length} mode(s)`,
      ``,
      ...makeModePreviewLines("Mobile preview", mobileDefs),
      ``,
      ...makeModePreviewLines("Tablet preview", tabletDefs),
      ``,
      ...makeModePreviewLines("Desktop preview", desktopDefs),
    ].join("\n")
  );

  figma.notify("Mode-based tokens updated 🎉");
}

async function applyStyles(
  baseFontSize: number,
  scaleRatio: number,
  fontFamily: string,
  headingWeights: string[],
  bodyWeights: string[]
) {
  const defs = makeStyleDefs(
    baseFontSize,
    scaleRatio,
    fontFamily,
    headingWeights,
    bodyWeights
  );

  const { variables } = await ensureTypographyStructure();

  let createdCount = 0;
  const errors: string[] = [];

  for (const def of defs) {
    try {
      const loadedFont = await loadFontWithFallback(def.family, def.style);

      removeExistingStyleByName(def.name);

      const style = figma.createTextStyle();
      style.name = def.name;
      style.fontName = loadedFont;
      style.fontSize = def.fontSize;
      style.lineHeight = {
        unit: "PIXELS",
        value: def.lineHeight,
      };
      style.letterSpacing = {
        unit: "PIXELS",
        value: def.letterSpacing,
      };

      bindStyleToVariables(style, def.tokenGroup, variables);
      createdCount += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${def.name}: ${message}`);
    }
  }

  if (errors.length > 0) {
    sendLog(
      [
        `Applied styles with some errors`,
        `Base font size: ${baseFontSize}`,
        `Scale ratio: ${scaleRatio}`,
        `Created ${createdCount}/${defs.length} styles`,
        ``,
        `Scale preview:`,
        ...makePreviewLines(defs),
        ``,
        `Errors:`,
        ...errors,
      ].join("\n")
    );

    figma.notify(`Created ${createdCount} styles. Some errors occurred.`);
    return;
  }

  sendLog(
    [
      `Success!`,
      `Applied styles`,
      `Base font size: ${baseFontSize}`,
      `Scale ratio: ${scaleRatio}`,
      `Created ${createdCount} styles`,
      ``,
      `Scale preview:`,
      ...makePreviewLines(defs),
    ].join("\n")
  );

  figma.notify("Styles created and bound 🎉");
}

async function applyBoth(
  mobileBaseFontSize: number,
  mobileScaleRatio: number,
  tabletBaseFontSize: number,
  tabletScaleRatio: number,
  desktopBaseFontSize: number,
  desktopScaleRatio: number,
  fontFamily: string,
  headingWeights: string[],
  bodyWeights: string[]
) {
  const mobileDefs = makeStyleDefs(
    mobileBaseFontSize,
    mobileScaleRatio,
    fontFamily,
    headingWeights,
    bodyWeights
  );

  const tabletDefs = makeStyleDefs(
    tabletBaseFontSize,
    tabletScaleRatio,
    fontFamily,
    headingWeights,
    bodyWeights
  );

  const desktopDefs = makeStyleDefs(
    desktopBaseFontSize,
    desktopScaleRatio,
    fontFamily,
    headingWeights,
    bodyWeights
  );

  const { collection, variables } = await ensureTypographyStructure();

  updateVariablesForAllModes(mobileDefs, tabletDefs, desktopDefs, collection, variables);

  const defs = desktopDefs;

  let createdCount = 0;
  const errors: string[] = [];

  for (const def of defs) {
    try {
      const loadedFont = await loadFontWithFallback(def.family, def.style);
  
      removeExistingStyleByName(def.name);
  
      const style = figma.createTextStyle();
      style.name = def.name;
      style.fontName = loadedFont;
      style.fontSize = def.fontSize;
      style.lineHeight = {
        unit: "PIXELS",
        value: def.lineHeight,
      };
      style.letterSpacing = {
        unit: "PIXELS",
        value: def.letterSpacing,
      };
  
      bindStyleToVariables(style, def.tokenGroup, variables);
      createdCount += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${def.name}: ${message}`);
    }
  }

  if (errors.length > 0) {
    sendLog(
      [
        `Applied tokens + styles with some errors`,
        ``,
        `Mobile: base ${mobileBaseFontSize}, ratio ${mobileScaleRatio}`,
        `Tablet: base ${tabletBaseFontSize}, ratio ${tabletScaleRatio}`,
        `Desktop: base ${desktopBaseFontSize}, ratio ${desktopScaleRatio}`,
        `Updated variables in ${collection.modes.length} mode(s)`,
        `Created ${createdCount}/${defs.length} styles`,
        ``,
        ...makeModePreviewLines("Mobile preview", mobileDefs),
        ``,
        ...makeModePreviewLines("Tablet preview", tabletDefs),
        ``,
        ...makeModePreviewLines("Desktop preview", desktopDefs),
        ``,
        `Errors:`,
        ...errors,
      ].join("\n")
    );

    figma.notify("Applied both with some errors.");
    return;
  }

  sendLog(
    [
      `Success!`,
      `Applied tokens + styles`,
      ``,
      `Mobile: base ${mobileBaseFontSize}, ratio ${mobileScaleRatio}`,
      `Tablet: base ${tabletBaseFontSize}, ratio ${tabletScaleRatio}`,
      `Desktop: base ${desktopBaseFontSize}, ratio ${desktopScaleRatio}`,
      `Updated variables in ${collection.modes.length} mode(s)`,
      `Created ${createdCount} styles`,
      ``,
      ...makeModePreviewLines("Mobile preview", mobileDefs),
      ``,
      ...makeModePreviewLines("Tablet preview", tabletDefs),
      ``,
      ...makeModePreviewLines("Desktop preview", desktopDefs),
    ].join("\n")
  );

  figma.notify("Applied mode-based tokens + styles 🎉");
}

async function previewTypographyFrame(
  mobileBaseFontSize: number,
  mobileScaleRatio: number,
  tabletBaseFontSize: number,
  tabletScaleRatio: number,
  desktopBaseFontSize: number,
  desktopScaleRatio: number,
  fontFamily: string,
  headingWeights: string[],
  bodyWeights: string[]
) {
  const mobileDefs = makeStyleDefs(
    mobileBaseFontSize,
    mobileScaleRatio,
    fontFamily,
    headingWeights,
    bodyWeights
  );

  const tabletDefs = makeStyleDefs(
    tabletBaseFontSize,
    tabletScaleRatio,
    fontFamily,
    headingWeights,
    bodyWeights
  );

  const desktopDefs = makeStyleDefs(
    desktopBaseFontSize,
    desktopScaleRatio,
    fontFamily,
    headingWeights,
    bodyWeights
  );

  const collection = await getVariableCollectionByName(VARIABLE_COLLECTION_NAME);
  const variables = getVariablesInCollection(collection);

  const frame = await getOrCreatePreviewFrame();

  frame.layoutMode = "VERTICAL";
  frame.primaryAxisSizingMode = "AUTO";
  frame.counterAxisSizingMode = "FIXED";
  frame.resize(900, Math.max(frame.height, 400));
  frame.itemSpacing = 20;
  frame.paddingTop = 24;
  frame.paddingBottom = 24;
  frame.paddingLeft = 24;
  frame.paddingRight = 24;
  frame.cornerRadius = 16;
  frame.fills = [
    {
      type: "SOLID",
      color: { r: 1, g: 1, b: 1 },
    },
  ];
  frame.strokes = [
    {
      type: "SOLID",
      color: { r: 0.9, g: 0.9, b: 0.9 },
    },
  ];

  const titleFont = await loadFontWithFallback(fontFamily, "SemiBold");
  const bodyFont = await loadFontWithFallback(fontFamily, "Regular");

  const title = await getOrCreateTextNode(
    frame,
    "preview-title",
    "Preview Title",
    titleFont
  );
  title.characters = "TypeFlow Preview";
  title.fontName = titleFont;
  title.fontSize = 24;
  title.lineHeight = { unit: "PIXELS", value: 32 };
  title.textAutoResize = "HEIGHT";
  title.resize(820, title.height);

  const subtitle = await getOrCreateTextNode(
    frame,
    "preview-subtitle",
    "Preview Subtitle",
    bodyFont
  );
  subtitle.characters =
    `Grouped preview · Mobile ${mobileBaseFontSize}/${mobileScaleRatio} · Tablet ${tabletBaseFontSize}/${tabletScaleRatio} · Desktop ${desktopBaseFontSize}/${desktopScaleRatio}`;
  subtitle.fontName = bodyFont;
  subtitle.fontSize = 14;
  subtitle.lineHeight = { unit: "PIXELS", value: 22 };
  subtitle.textAutoResize = "HEIGHT";
  subtitle.resize(820, subtitle.height);

  const headingGroup = getOrCreateSection(
    frame,
    "preview-group-heading",
    "Heading Preview Group"
  );
  const bodyGroup = getOrCreateSection(
    frame,
    "preview-group-body",
    "Body Preview Group"
  );
  const captionGroup = getOrCreateSection(
    frame,
    "preview-group-caption",
    "Caption Preview Group"
  );

  const groupSections = {
    heading: headingGroup,
    body: bodyGroup,
    caption: captionGroup,
  };

  for (const category of ["heading", "body", "caption"] as const) {
    const groupFrame = groupSections[category];
    groupFrame.layoutMode = "VERTICAL";
    groupFrame.primaryAxisSizingMode = "AUTO";
    groupFrame.counterAxisSizingMode = "FIXED";
    groupFrame.resize(820, Math.max(groupFrame.height, 100));
    groupFrame.itemSpacing = 12;
    groupFrame.paddingTop = 16;
    groupFrame.paddingBottom = 16;
    groupFrame.paddingLeft = 16;
    groupFrame.paddingRight = 16;
    groupFrame.cornerRadius = 12;
    groupFrame.layoutAlign = "STRETCH";
    groupFrame.fills = [
      {
        type: "SOLID",
        color: { r: 0.98, g: 0.98, b: 0.985 },
      },
    ];
    groupFrame.strokes = [
      {
        type: "SOLID",
        color: { r: 0.92, g: 0.92, b: 0.94 },
      },
    ];

    const groupLabel = await getOrCreateTextNode(
      groupFrame,
      `preview-group-label-${category}`,
      `${category} Group Label`,
      titleFont
    );
    groupLabel.characters = getPreviewCategoryLabel(category);
    groupLabel.fontName = titleFont;
    groupLabel.fontSize = 16;
    groupLabel.lineHeight = { unit: "PIXELS", value: 24 };
    groupLabel.textAutoResize = "HEIGHT";
    groupLabel.resize(760, groupLabel.height);
  }

  const defs = desktopDefs;

  for (const def of defs) {
    const category = getPreviewCategory(def);
    const groupFrame = groupSections[category];

    const itemSection = getOrCreateSection(
      groupFrame,
      `preview-item-${def.group}`,
      `${def.name} Preview Item`
    );
    itemSection.layoutMode = "VERTICAL";
    itemSection.primaryAxisSizingMode = "AUTO";
    itemSection.counterAxisSizingMode = "FIXED";
    itemSection.resize(760, Math.max(itemSection.height, 80));
    itemSection.itemSpacing = 6;
    itemSection.paddingTop = 10;
    itemSection.paddingBottom = 10;
    itemSection.paddingLeft = 10;
    itemSection.paddingRight = 10;
    itemSection.cornerRadius = 10;
    itemSection.layoutAlign = "STRETCH";
    itemSection.fills = [
      {
        type: "SOLID",
        color: { r: 1, g: 1, b: 1 },
      },
    ];
    itemSection.strokes = [
      {
        type: "SOLID",
        color: { r: 0.93, g: 0.93, b: 0.95 },
      },
    ];

    const nameText = await getOrCreateTextNode(
      itemSection,
      `preview-name-${def.group}`,
      `${def.name} Name`,
      bodyFont
    );
    nameText.characters = def.name;
    nameText.fontName = titleFont;
    nameText.fontSize = 12;
    nameText.lineHeight = { unit: "PIXELS", value: 18 };
    nameText.textAutoResize = "HEIGHT";
    nameText.resize(720, nameText.height);

    const mobileMode = collection.modes.find((m) => getModeType(m.name) === "mobile");
    const tabletMode = collection.modes.find((m) => getModeType(m.name) === "tablet");
    const desktopMode = collection.modes.find((m) => getModeType(m.name) === "desktop");

    const mobileFontSize = mobileMode
      ? getVariableValue(variables, `${def.tokenGroup}/font-size`, mobileMode.modeId)
      : null;
    const mobileLineHeight = mobileMode
      ? getVariableValue(variables, `${def.tokenGroup}/line-height`, mobileMode.modeId)
      : null;
    const mobileLetterSpacing = mobileMode
      ? getVariableValue(variables, `${def.tokenGroup}/letter-spacing`, mobileMode.modeId)
      : null;

    const tabletFontSize = tabletMode
      ? getVariableValue(variables, `${def.tokenGroup}/font-size`, tabletMode.modeId)
      : null;
    const tabletLineHeight = tabletMode
      ? getVariableValue(variables, `${def.tokenGroup}/line-height`, tabletMode.modeId)
      : null;
    const tabletLetterSpacing = tabletMode
      ? getVariableValue(variables, `${def.tokenGroup}/letter-spacing`, tabletMode.modeId)
      : null;

    const desktopFontSize = desktopMode
      ? getVariableValue(variables, `${def.tokenGroup}/font-size`, desktopMode.modeId)
      : null;
    const desktopLineHeight = desktopMode
      ? getVariableValue(variables, `${def.tokenGroup}/line-height`, desktopMode.modeId)
      : null;
    const desktopLetterSpacing = desktopMode
      ? getVariableValue(variables, `${def.tokenGroup}/letter-spacing`, desktopMode.modeId)
      : null;

    const metaText = await getOrCreateTextNode(
      itemSection,
      `preview-meta-${def.group}`,
      `${def.name} Meta`,
      bodyFont
    );
    metaText.characters = [
      makeModeMetaLine("M", mobileFontSize, mobileLineHeight, mobileLetterSpacing),
      makeModeMetaLine("T", tabletFontSize, tabletLineHeight, tabletLetterSpacing),
      makeModeMetaLine("D", desktopFontSize, desktopLineHeight, desktopLetterSpacing),
    ].join("   ");
    metaText.fontName = bodyFont;
    metaText.fontSize = 11;
    metaText.lineHeight = { unit: "PIXELS", value: 16 };
    metaText.textAutoResize = "HEIGHT";
    metaText.resize(720, metaText.height);

    const existingSample = findChildByRole(itemSection, `preview-sample-${def.group}`);
    let sampleText = "The quick brown fox jumps over the lazy dog";

    if (
      existingSample &&
      existingSample.type === "TEXT" &&
      existingSample.characters.trim() !== ""
    ) {
      sampleText = existingSample.characters;
      existingSample.remove();
    }

    const sample = figma.createText();
    sample.name = `${def.name} Sample`;
    setRole(sample, `preview-sample-${def.group}`);

    const localStyle = figma.getLocalTextStyles().find((s) => s.name === def.name);

    if (localStyle) {
      const styleFont = localStyle.fontName;
      await figma.loadFontAsync(styleFont);
      
      sample.characters = sampleText;
      sample.textStyleId = localStyle.id;

      sample.characters = sampleText;
      sample.textStyleId = localStyle.id;
    } else {
      const fallbackFont = await loadFontWithFallback(def.family, def.style);
      await figma.loadFontAsync(fallbackFont);
      sample.fontName = fallbackFont;
      sample.characters = sampleText;
      sample.fontSize = def.fontSize;
      sample.lineHeight = {
        unit: "PIXELS",
        value: def.lineHeight,
      };
      sample.letterSpacing = {
        unit: "PIXELS",
        value: def.letterSpacing,
      };
    }

    sample.layoutAlign = "STRETCH";
    sample.textAutoResize = "HEIGHT";
    itemSection.appendChild(sample);
  }

  reorderGroupedPreviewSections(frame);
  figma.viewport.scrollAndZoomIntoView([frame]);

  sendLog(
    [
      `Preview updated`,
      `Grouped preview uses currently bound text styles.`,
      `Mobile input: base ${mobileBaseFontSize}, ratio ${mobileScaleRatio}`,
      `Tablet input: base ${tabletBaseFontSize}, ratio ${tabletScaleRatio}`,
      `Desktop input: base ${desktopBaseFontSize}, ratio ${desktopScaleRatio}`,
      ``,
      `Preview style set (desktop reference):`,
      ...makePreviewLines(defs),
    ].join("\n")
  );

  figma.notify("Preview updated 👀");
}

async function previewTypography(
  mobileBaseFontSize: number,
  mobileScaleRatio: number,
  tabletBaseFontSize: number,
  tabletScaleRatio: number,
  desktopBaseFontSize: number,
  desktopScaleRatio: number,
  fontFamily: string,
  headingWeights: string[],
  bodyWeights: string[]
) {
  await previewTypographyFrame(
    mobileBaseFontSize,
    mobileScaleRatio,
    tabletBaseFontSize,
    tabletScaleRatio,
    desktopBaseFontSize,
    desktopScaleRatio,
    fontFamily,
    headingWeights,
    bodyWeights
  );
}
async function exportJson(
  mobileBaseFontSize: number,
  mobileScaleRatio: number,
  tabletBaseFontSize: number,
  tabletScaleRatio: number,
  desktopBaseFontSize: number,
  desktopScaleRatio: number,
  fontFamily: string,
  headingWeights: string[],
  bodyWeights: string[]
) {
  const mobileDefs = makeStyleDefs(
    mobileBaseFontSize,
    mobileScaleRatio,
    fontFamily,
    headingWeights,
    bodyWeights
  );

  const tabletDefs = makeStyleDefs(
    tabletBaseFontSize,
    tabletScaleRatio,
    fontFamily,
    headingWeights,
    bodyWeights
  );

  const desktopDefs = makeStyleDefs(
    desktopBaseFontSize,
    desktopScaleRatio,
    fontFamily,
    headingWeights,
    bodyWeights
  );

  const json = JSON.stringify(
    buildCombinedExport(mobileDefs, tabletDefs, desktopDefs),
    null,
    2
  );
  sendLog(json);
  figma.notify("Structured JSON exported 🎉");
}

async function exportCss(
  desktopBaseFontSize: number,
  desktopScaleRatio: number,
  fontFamily: string,
  headingWeights: string[],
  bodyWeights: string[]
) {
  const defs = makeStyleDefs(
    desktopBaseFontSize,
    desktopScaleRatio,
    fontFamily,
    headingWeights,
    bodyWeights
  );

  const css = buildCssExport(defs);
  sendLog(css);
  figma.notify("CSS exported");
}

async function copyJson(
  mobileBaseFontSize: number,
  mobileScaleRatio: number,
  tabletBaseFontSize: number,
  tabletScaleRatio: number,
  desktopBaseFontSize: number,
  desktopScaleRatio: number,
  fontFamily: string,
  headingWeights: string[],
  bodyWeights: string[]
) {
  const mobileDefs = makeStyleDefs(
    mobileBaseFontSize,
    mobileScaleRatio,
    fontFamily,
    headingWeights,
    bodyWeights
  );

  const tabletDefs = makeStyleDefs(
    tabletBaseFontSize,
    tabletScaleRatio,
    fontFamily,
    headingWeights,
    bodyWeights
  );

  const desktopDefs = makeStyleDefs(
    desktopBaseFontSize,
    desktopScaleRatio,
    fontFamily,
    headingWeights,
    bodyWeights
  );

  const json = JSON.stringify(
    buildCombinedExport(mobileDefs, tabletDefs, desktopDefs),
    null,
    2
  );
  sendCopyPayload(json);
  sendLog(json);
  figma.notify("Structured JSON copied 🎉");
}

async function copyCss(
  desktopBaseFontSize: number,
  desktopScaleRatio: number,
  fontFamily: string,
  headingWeights: string[],
  bodyWeights: string[]
) {
  const defs = makeStyleDefs(
    desktopBaseFontSize,
    desktopScaleRatio,
    fontFamily,
    headingWeights,
    bodyWeights
  );

  const css = buildCssExport(defs);
  sendCopyPayload(css);
  sendLog(css);
  figma.notify("CSS copied");
}

async function importTypeFlowJson(importJsonText: string) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(importJsonText);
  } catch {
    throw new Error("Invalid JSON. Please paste valid TypeFlow JSON.");
  }

  validateImportedTypeFlowJson(parsed);
  const imported = parsed as ImportedTypeFlowJson;

  const { collection, variables } = await ensureTypographyStructure();

  setImportedValuesForModes(imported, collection, variables);

  const { createdCount, errors } = await createStylesFromImportedJson(
    imported,
    variables
  );

  if (errors.length > 0) {
    sendLog(
      [
        `Imported TypeFlow JSON with some errors`,
        `Updated variables in ${collection.modes.length} mode(s)`,
        `Created ${createdCount}/${Object.keys(imported.styles.styles).length} styles`,
        ``,
        `Errors:`,
        ...errors,
      ].join("\n")
    );

    figma.notify(`Imported with ${errors.length} error(s).`);
    return;
  }

  sendLog(
    [
      `Success!`,
      `Imported TypeFlow JSON`,
      `Updated variables in ${collection.modes.length} mode(s)`,
      `Created ${createdCount} styles`,
    ].join("\n")
  );

  figma.notify("TypeFlow JSON imported 🎉");
}


async function getStoredPresets(): Promise<Record<string, PresetValues>> {
  const saved = await figma.clientStorage.getAsync(PRESET_STORAGE_KEY);
  if (!saved || typeof saved !== "object") {
    return {};
  }
  return saved as Record<string, PresetValues>;
}

async function setStoredPresets(presets: Record<string, PresetValues>) {
  await figma.clientStorage.setAsync(PRESET_STORAGE_KEY, presets);
}

async function sendPresetListToUI(selectedName?: string) {
  const presets = await getStoredPresets();
  figma.ui.postMessage({
    type: "preset-list",
    presets,
    selectedName: selectedName ?? "",
  });
}


figma.ui.onmessage = async (msg: PluginMessage) => {
  try {
    const fontFamily = msg.fontFamily ?? "Inter";
    const headingWeights = msg.headingWeights ?? ["Regular", "Medium", "SemiBold"];
    const bodyWeights = msg.bodyWeights ?? ["Regular", "Medium"];

    const mobileBaseFontSize = msg.mobileBaseFontSize ?? 16;
    const mobileScaleRatio = msg.mobileScaleRatio ?? 1.2;
    const tabletBaseFontSize = msg.tabletBaseFontSize ?? 17;
    const tabletScaleRatio = msg.tabletScaleRatio ?? 1.22;
    const desktopBaseFontSize = msg.desktopBaseFontSize ?? 18;
    const desktopScaleRatio = msg.desktopScaleRatio ?? 1.25;

    if (msg.type === "test") {
      debugCollections();
      figma.notify("Collection debug logged");
      return;
    }

    if (msg.type === "get-presets") {
      await sendPresetListToUI();
      return;
    }

    if (msg.type === "save-preset") {
      const name = msg.presetName?.trim();
      const values = msg.presetValues;

      if (!name || !values) {
        figma.notify("Preset name or values are missing.");
        return;
      }

      const presets = await getStoredPresets();
      presets[name] = values;
      await setStoredPresets(presets);
      await sendPresetListToUI(name);
      figma.notify(`Preset saved: ${name}`);
      return;
    }

    if (msg.type === "delete-preset") {
      const name = msg.presetName?.trim();

      if (!name) {
        figma.notify("Select a preset first.");
        return;
      }

      const presets = await getStoredPresets();
      delete presets[name];
      await setStoredPresets(presets);
      await sendPresetListToUI();
      figma.notify(`Preset deleted: ${name}`);
      return;
    }

    if (msg.type === "preview") {


      await previewTypography(
        mobileBaseFontSize,
        mobileScaleRatio,
        tabletBaseFontSize,
        tabletScaleRatio,
        desktopBaseFontSize,
        desktopScaleRatio,
        fontFamily,
        headingWeights,
        bodyWeights
      );
      return;
    }

    if (msg.type === "apply-both") {
      await applyBoth(
        mobileBaseFontSize,
        mobileScaleRatio,
        tabletBaseFontSize,
        tabletScaleRatio,
        desktopBaseFontSize,
        desktopScaleRatio,
        fontFamily,
        headingWeights,
        bodyWeights
      );
      return;
    }

    if (msg.type === "export-json") {
      await exportJson(
        mobileBaseFontSize,
        mobileScaleRatio,
        tabletBaseFontSize,
        tabletScaleRatio,
        desktopBaseFontSize,
        desktopScaleRatio,
        fontFamily,
        headingWeights,
        bodyWeights
      );
      return;
    }

    if (msg.type === "export-css") {
      await exportCss(
        desktopBaseFontSize,
        desktopScaleRatio,
        fontFamily,
        headingWeights,
        bodyWeights
      );
      return;
    }

    if (msg.type === "copy-json") {
      await copyJson(
        mobileBaseFontSize,
        mobileScaleRatio,
        tabletBaseFontSize,
        tabletScaleRatio,
        desktopBaseFontSize,
        desktopScaleRatio,
        fontFamily,
        headingWeights,
        bodyWeights
      );
      return;
    }

    if (msg.type === "copy-css") {
      await copyCss(
        desktopBaseFontSize,
        desktopScaleRatio,
        fontFamily,
        headingWeights,
        bodyWeights
      );
      return;
    }

    if (msg.type === "import-json") {
      const importJsonText = msg.importJsonText?.trim();

      if (!importJsonText) {
        figma.notify("Paste JSON first.");
        return;
      }

      await importTypeFlowJson(importJsonText);
      return;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    figma.notify(`Error: ${message}`);
    sendLog(`ERROR:
${message}`);
    console.error(error);
  }
};

sendPresetListToUI().catch((error) => {
  console.error("Failed to load preset list", error);
});
