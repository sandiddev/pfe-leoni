import type { AbcClass, MeasurementUnit } from "@leoni/core";

/**
 * A synthetic but realistic article catalogue for an automotive wiring-harness
 * plant: contacts, terminals, seals, connector housings, cable, tape, sleeving,
 * fuses and relays.
 *
 * It is generated deterministically from a seeded pseudo-random sequence rather
 * than with a random library, so `pnpm db:seed` produces byte-identical data on
 * every machine. That matters more than it sounds: a screenshot in the report
 * and the screen shown during the defence have to agree, and a reviewer
 * re-running the seed has to see the numbers the report quotes.
 *
 * Replace this module with the real CSV import once LEONI supplies the export;
 * the shape below is exactly what the importer will produce.
 */

export interface SeedArticle {
  readonly reference: string;
  readonly designation: string;
  readonly unit: MeasurementUnit;
  readonly vpe: number;
  readonly leadTimeDays: number;
  readonly abcClass: AbcClass;
  /** Mean units consumed per day at LTN1. Drives every threshold. */
  readonly dailyConsumption: number;
}

/**
 * Mulberry32 — a small, fast, fully deterministic PRNG.
 *
 * Written out rather than pulled from a dependency because the whole value here
 * is reproducibility, and that is easier to guarantee for eight lines of
 * arithmetic than for a package that might change its algorithm in a minor
 * release.
 */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

interface Family {
  readonly code: string;
  readonly label: string;
  /** Non-empty by type, so `pick` never has to assert that a value exists. */
  readonly variants: readonly [string, ...string[]];
  /** Units per box actually used for this kind of part. Non-empty by type. */
  readonly packSizes: readonly [number, ...number[]];
  /**
   * How the family is counted.
   *
   * Cable and conduit are cut from a reel and issued by the metre; everything
   * else is discrete. Two units in the seeded catalogue rather than one, so the
   * column is visibly doing something on the demo screens.
   */
  readonly unit: MeasurementUnit;
}

const FAMILIES: readonly [Family, ...Family[]] = [
  {
    code: "CTC",
    label: "Contact",
    variants: ["femelle 0.64", "male 0.64", "femelle 1.5", "male 1.5", "femelle 2.8", "male 2.8"],
    packSizes: [500, 1_000, 2_000, 5_000],
    unit: "PIECE",
  },
  {
    code: "JPT",
    label: "Joint passe-fil",
    variants: ["silicone bleu", "silicone vert", "silicone gris", "silicone orange"],
    packSizes: [500, 1_000, 2_000],
    unit: "PIECE",
  },
  {
    code: "BTR",
    label: "Boitier connecteur",
    variants: ["2 voies", "4 voies", "6 voies", "8 voies", "12 voies", "16 voies", "24 voies"],
    packSizes: [50, 100, 250, 500],
    unit: "PIECE",
  },
  {
    code: "CBL",
    label: "Cable FLRY-B",
    variants: ["0.35 mm2", "0.50 mm2", "0.75 mm2", "1.00 mm2", "1.50 mm2", "2.50 mm2"],
    packSizes: [100, 200, 500],
    unit: "METRE",
  },
  {
    code: "RBN",
    label: "Ruban adhesif",
    variants: ["PET noir 19mm", "PVC noir 19mm", "tissu 25mm", "mousse 19mm"],
    packSizes: [24, 48, 96],
    unit: "PIECE",
  },
  {
    code: "GNE",
    label: "Gaine annelee",
    variants: ["NW7.5", "NW10", "NW13", "NW17", "NW22"],
    packSizes: [25, 50, 100],
    unit: "METRE",
  },
  {
    code: "FUS",
    label: "Fusible",
    variants: ["5A", "7.5A", "10A", "15A", "20A", "25A", "30A"],
    packSizes: [100, 250, 500],
    unit: "PIECE",
  },
  {
    code: "RLY",
    label: "Relais",
    variants: ["12V 20A", "12V 30A", "12V 40A", "bistable 12V"],
    packSizes: [20, 50, 100],
    unit: "PIECE",
  },
  {
    code: "TBL",
    label: "Tube thermoretractable",
    variants: ["2:1 3mm", "2:1 6mm", "3:1 9mm", "3:1 12mm"],
    packSizes: [50, 100, 200],
    unit: "METRE",
  },
  {
    code: "CLP",
    label: "Clip de fixation",
    variants: ["sapin 6mm", "sapin 8mm", "rotatif", "double aile"],
    packSizes: [200, 500, 1_000],
    unit: "PIECE",
  },
];

/**
 * Picks one element.
 *
 * The parameter is typed as a non-empty tuple rather than a plain array, which
 * is what lets the fallback below be a real value instead of a non-null
 * assertion: the compiler knows `values[0]` exists.
 */
function pick<T>(random: () => number, values: readonly [T, ...T[]]): T {
  const index = Math.floor(random() * values.length);
  return values[index] ?? values[0];
}

/**
 * Builds the catalogue.
 *
 * Consumption is drawn so that the resulting ABC distribution is realistic:
 * a small number of very fast movers, a middle band, and a long tail of parts
 * consumed a handful of times a week. That shape is what makes the ABC screen
 * and the Pareto chart meaningful during the defence rather than uniform noise.
 */
export function buildCatalogue(count = 150): SeedArticle[] {
  const random = createRandom(20_260_822);
  const articles: SeedArticle[] = [];
  const usedReferences = new Set<string>();

  for (let index = 0; index < count; index += 1) {
    const family = pick(random, FAMILIES);
    const variant = pick(random, family.variants);

    const reference = `${family.code}-${String(10_000 + index * 7).padStart(5, "0")}`;
    if (usedReferences.has(reference)) continue;
    usedReferences.add(reference);

    // Roughly 15% fast movers, 25% medium, 60% slow — close to the Pareto
    // shape a real harness plant shows.
    const draw = random();
    const abcClass: AbcClass = draw < 0.15 ? "A" : draw < 0.4 ? "B" : "C";

    const dailyConsumption =
      abcClass === "A"
        ? Math.round(200 + random() * 800)
        : abcClass === "B"
          ? Math.round(30 + random() * 170)
          : Math.round(1 + random() * 29);

    articles.push({
      reference,
      designation: `${family.label} ${variant}`,
      unit: family.unit,
      vpe: pick(random, family.packSizes),
      // Class A parts are ordered often and LTN4 keeps them staged, so they
      // move faster than the long tail.
      leadTimeDays: abcClass === "A" ? 1 : abcClass === "B" ? 2 : 3,
      abcClass,
      dailyConsumption,
    });
  }

  return articles;
}
