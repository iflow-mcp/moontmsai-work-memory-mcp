import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface DatabaseConnection {
  run: (sql: string, params?: any[]) => any;
  get: (sql: string, params?: any[]) => any;
  all: (sql: string, params?: any[]) => any[];
  close: () => void;
  batch: (operations: Array<{sql: string, params?: any[]}>) => any[];
  query: <T = any>(sql: string, params?: any[]) => T;
}

class DatabaseManager {
  private static instance: DatabaseManager;
  private dbPath: string;
  private db: Database.Database | null = null;
  private readonly CACHE_TTL = 30000;
  private cleanupTimer: NodeJS.Timeout | null = null;

  private constructor() {
    const workMemoryDir = process.env.WORK_MEMORY_DIR;
    
    if (workMemoryDir) {
      const dbFileName = process.env.DB_FILENAME || 'database.sqlite';
      this.dbPath = path.join(workMemoryDir, dbFileName);
    } else {
      const workMemoryDirRel = 'work_memory';
      const dbFileName = 'database.sqlite';
      this.dbPath = path.join(process.cwd(), workMemoryDirRel, dbFileName);
    }
    
    this.startCleanupTimer();
  }

  public static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  private createOptimizedDatabase(): Database.Database {
    const db = new Database(this.dbPath);
    
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -64000');
    db.pragma('temp_store = MEMORY');
    db.pragma('busy_timeout = 5000');
    
    return db;
  }

  private getOrCreateConnection(): Database.Database {
    if (!this.db) {
      this.db = this.createOptimizedDatabase();
    }
    return this.db;
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      // better-sqlite3 handles cleanup automatically
    }, this.CACHE_TTL / 2);
  }

  public async initialize(): Promise<DatabaseConnection> {
    const workMemoryDir = path.dirname(this.dbPath);
    if (!fs.existsSync(workMemoryDir)) {
      fs.mkdirSync(workMemoryDir, { recursive: true });
    }
    return this.createConnection();
  }

  private createConnection(): DatabaseConnection {
    const run = (sql: string, params?: any[]): any => {
      const db = this.getOrCreateConnection();
      const stmt = db.prepare(sql);
      const result = stmt.run(params || []);
      return { changes: result.changes, lastID: result.lastInsertRowid };
    };

    const get = (sql: string, params?: any[]): any => {
      const db = this.getOrCreateConnection();
      const stmt = db.prepare(sql);
      return stmt.get(params || []);
    };

    const all = (sql: string, params?: any[]): any[] => {
      const db = this.getOrCreateConnection();
      const stmt = db.prepare(sql);
      return stmt.all(params || []);
    };
    
    const batch = (operations: Array<{sql: string, params?: any[]}>): any[] => {
      const db = this.getOrCreateConnection();
      const results: any[] = [];
      
      db.transaction(() => {
        operations.forEach(op => {
          const stmt = db.prepare(op.sql);
          const result = stmt.run(op.params || []);
          results.push({ changes: result.changes, lastID: result.lastInsertRowid });
        });
      })();
      
      return results;
    };

    const query = <T = any>(sql: string, params?: any[]): T => {
      const trimmedSql = sql.trim().toLowerCase();
      if (trimmedSql.startsWith('select')) {
        if (trimmedSql.includes('limit 1')) {
          return get(sql, params) as T;
        } else {
          return all(sql, params) as unknown as T;
        }
      } else {
        return run(sql, params) as T;
      }
    };
    
    const close = (): void => {
      if (this.db) {
        this.db.close();
        this.db = null;
      }
    };

    return { run, get, all, close, batch, query };
  }

  public async close(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  public getConnection(): DatabaseConnection {
    return this.createConnection();
  }

  public getDbPath(): string {
    return this.dbPath;
  }

  public getConnectionStats(): { cached: boolean; useCount: number; age: number } {
    return { cached: false, useCount: 0, age: 0 };
  }
}

const databaseManager = DatabaseManager.getInstance();
export default databaseManager;