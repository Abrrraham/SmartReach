declare module "suggestions-list" {
  export interface TypeaheadOptions {
    [key: string]: unknown;
  }

  export default class Typeahead<T> {
    constructor(
      input: HTMLInputElement,
      data: T[],
      options: TypeaheadOptions
    );
    update(data: T[]): void;
    clear(): void;
  }
}
