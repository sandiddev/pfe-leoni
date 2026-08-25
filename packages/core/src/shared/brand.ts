declare const brand: unique symbol;

/**
 * Nominal typing for identifiers.
 *
 * Every identifier in this domain is a string, which means the compiler will
 * happily let an article id be passed where a request id is expected. Branding
 * closes that hole at zero runtime cost.
 */
export type Brand<TValue, TBrand extends string> = TValue & {
  readonly [brand]: TBrand;
};

export type ArticleId = Brand<string, "ArticleId">;
export type SiteId = Brand<string, "SiteId">;
export type StockItemId = Brand<string, "StockItemId">;
export type ReplenishmentRequestId = Brand<string, "ReplenishmentRequestId">;
export type UserId = Brand<string, "UserId">;

/**
 * Widens a raw string into a branded id at a trusted boundary — a repository
 * reading a row it just queried, the seed, or a test fixture.
 *
 * The assertion inside is unavoidable and deliberate: a brand is a phantom type
 * with no runtime representation, so there is nothing here that could be
 * checked. Confining that single assertion to this one named function is
 * precisely what keeps the rest of the codebase free of casts, and makes every
 * place an untrusted string becomes an id greppable.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- naming the target brand is the entire purpose of this helper.
export function toBrandedId<TId extends Brand<string, string>>(value: string): TId {
  // eslint-disable-next-line no-restricted-syntax -- the one sanctioned assertion in the codebase: a brand is a phantom type, so there is nothing here that could be checked. See docs/conventions.md.
  return value as TId;
}
