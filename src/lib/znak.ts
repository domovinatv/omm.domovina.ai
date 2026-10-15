/** Opcija A (D okvir, DOMOVINA paleta) umjesto pločice: `?znak=a` ili `?znak=A`. */
export const znakA = (url: URL) => url.searchParams.get("znak")?.toLowerCase() === "a";
