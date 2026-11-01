/** Serving's order of the state's entity keys, which orders a type's collections by their first entity, and each type's collections in the order serving first knew them, which emptying does not change. */
export class ServedOrder {
  #keys: string[] = [];
  readonly #known = new Map<string, Set<string>>();

  /** The keys in state order. */
  get keys(): readonly string[] {
    return this.#keys;
  }

  /** Hold the Evidence's entities in their own order. */
  reset(keys: readonly string[]): void {
    this.#keys = [...keys];
  }

  /** Add a key at `at` of its collection's `members`, beside them as serving places it, or last when the collection is empty. */
  place(key: string, members: readonly string[], at: number): void {
    const anchor =
      at < members.length
        ? this.#keys.indexOf(members[at]!)
        : members.length > 0
          ? this.#keys.indexOf(members.at(-1)!) + 1
          : this.#keys.length;
    this.#keys.splice(anchor, 0, key);
  }

  remove(key: string): void {
    this.#keys = this.#keys.filter((member) => member !== key);
  }

  remember(type: string, collection: string): void {
    const collections = this.#known.get(type) ?? new Set<string>();
    this.#known.set(type, collections.add(collection));
  }

  /** Every collection of a type the state has held, in the order serving remembers them. */
  known(type: string): readonly string[] {
    return [...(this.#known.get(type) ?? [])];
  }
}
