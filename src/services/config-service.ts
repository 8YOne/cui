import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { CUIConfig, DEFAULT_CONFIG } from '@/types/config';
import { generateMachineId } from '@/utils/machine-id';
import { createLogger, type Logger } from './logger';

/**
 * ConfigService manages CUI configuration
 * Loads from ~/.cui/config.json
 * Creates default config on first run
 */
export class ConfigService {
  private static instance: ConfigService;
  private config: CUIConfig | null = null;
  private logger: Logger;
  private configPath: string;
  private configDir: string;

  private constructor() {
    this.logger = createLogger('ConfigService');
    this.configDir = path.join(os.homedir(), '.cui');
    this.configPath = path.join(this.configDir, 'config.json');
  }

  /**
   * Get singleton instance
   */
  static getInstance(): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService();
    }
    return ConfigService.instance;
  }

  /**
   * Initialize configuration
   * Creates config file if it doesn't exist
   * Throws error if initialization fails
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing configuration', { configPath: this.configPath });

    try {
      // Check if config exists
      if (!fs.existsSync(this.configPath)) {
        await this.createDefaultConfig();
      }

      // Load and validate config
      await this.loadConfig();
    } catch (error) {
      this.logger.error('Failed to initialize configuration', error);
      throw new Error(`Configuration initialization failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get current configuration
   * Throws if not initialized
   */
  getConfig(): CUIConfig {
    if (!this.config) {
      throw new Error('Configuration not initialized. Call initialize() first.');
    }
    return this.config;
  }

  /**
   * Create default configuration
   */
  private async createDefaultConfig(): Promise<void> {
    this.logger.info('Creating default configuration');

    try {
      // Ensure config directory exists
      if (!fs.existsSync(this.configDir)) {
        fs.mkdirSync(this.configDir, { recursive: true });
        this.logger.debug('Created config directory', { dir: this.configDir });
      }

      // Generate machine ID
      const machineId = await generateMachineId();
      this.logger.debug('Generated machine ID', { machineId });

      // Generate crypto-secure auth token
      const authToken = crypto.randomBytes(16).toString('hex'); // 32 character hex string
      this.logger.debug('Generated auth token', { tokenLength: authToken.length });

      // Create default config
      const config: CUIConfig = {
        machine_id: machineId,
        authToken,
        ...DEFAULT_CONFIG
      };

      // Write config file
      fs.writeFileSync(
        this.configPath,
        JSON.stringify(config, null, 2),
        'utf-8'
      );

      this.logger.info('Default configuration created', {
        path: this.configPath,
        machineId: config.machine_id
      });
    } catch (error) {
      throw new Error(`Failed to create default config: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Load configuration from file
   */
  private async loadConfig(): Promise<void> {
    try {
      const configData = fs.readFileSync(this.configPath, 'utf-8');
      const config = JSON.parse(configData) as CUIConfig;

      // Validate required fields
      if (!config.machine_id) {
        throw new Error('Invalid config: missing machine_id');
      }
      if (!config.server || typeof config.server.port !== 'number') {
        throw new Error('Invalid config: missing or invalid server configuration');
      }
      if (!config.authToken) {
        throw new Error('Invalid config: missing authToken');
      }

      this.config = config;
      this.logger.debug('Configuration loaded successfully');
    } catch (error) {
      throw new Error(`Failed to load config: ${error instanceof Error ? error.message : String(error)}`);
    }
  }


  /**
   * Update configuration
   */
  async updateConfig(updates: Partial<CUIConfig>): Promise<void> {
    if (!this.config) {
      throw new Error('Configuration not initialized');
    }

    this.logger.info('Updating configuration', { updates });
    
    // Update in-memory config
    this.config = { ...this.config, ...updates };
    
    // Write to file
    try {
      fs.writeFileSync(
        this.configPath,
        JSON.stringify(this.config, null, 2),
        'utf-8'
      );
      this.logger.info('Configuration updated successfully');
    } catch (error) {
      this.logger.error('Failed to update configuration', error);
      throw new Error(`Failed to update config: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Reset singleton instance (for testing)
   */
  static resetInstance(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ConfigService.instance = null as any;
  }
}