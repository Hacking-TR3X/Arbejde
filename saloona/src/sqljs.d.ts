declare module 'sql.js' {
  type BindValue = string | number | null | Uint8Array;
  export interface Statement {
    bind(values?: BindValue[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, string | number | null | Uint8Array>;
    free(): boolean;
  }
  export interface Database {
    run(sql: string, params?: BindValue[]): Database;
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }
  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
  }
  export default function initSqlJs(config?: { locateFile?: (file: string) => string }): Promise<SqlJsStatic>;
}
