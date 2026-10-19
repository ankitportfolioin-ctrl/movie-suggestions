/**
 * Analytics Database Migration
 * Creates tables for traffic analytics, user sessions, and geographic data
 */
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL, 
  max: 3 
});

async function runMigration() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Page views table - tracks every page load
    await client.query(`
      CREATE TABLE IF NOT EXISTS analytics_page_views (
        id BIGSERIAL PRIMARY KEY,
        session_id UUID NOT NULL,
        anon_id VARCHAR(64) NOT NULL,
        path VARCHAR(512) NOT NULL,
        referrer VARCHAR(1024),
        user_agent TEXT,
        viewport_width INTEGER,
        viewport_height INTEGER,
        screen_width INTEGER,
        screen_height INTEGER,
        language VARCHAR(16),
        timezone VARCHAR(64),
        ip_hash VARCHAR(64) NOT NULL,
        country_code CHAR(2),
        country_name VARCHAR(128),
        region_code VARCHAR(32),
        region_name VARCHAR(128),
        city VARCHAR(128),
        latitude DECIMAL(10, 8),
        longitude DECIMAL(11, 8),
        isp VARCHAR(256),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // User sessions table - tracks session start/end and return visits
    await client.query(`
      CREATE TABLE IF NOT EXISTS analytics_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        anon_id VARCHAR(64) NOT NULL UNIQUE,
        first_seen TIMESTAMPTZ DEFAULT NOW(),
        last_seen TIMESTAMPTZ DEFAULT NOW(),
        total_page_views INTEGER DEFAULT 1,
        total_quiz_starts INTEGER DEFAULT 0,
        total_recommendations INTEGER DEFAULT 0,
        total_saves INTEGER DEFAULT 0,
        country_code CHAR(2),
        country_name VARCHAR(128),
        region_code VARCHAR(32),
        region_name VARCHAR(128),
        city VARCHAR(128),
        latitude DECIMAL(10, 8),
        longitude DECIMAL(11, 8),
        ip_hash VARCHAR(64) NOT NULL,
        isp VARCHAR(256),
        user_agent TEXT,
        is_returning BOOLEAN DEFAULT FALSE,
        days_since_first_visit INTEGER DEFAULT 0
      );
    `);

    // Events table - tracks specific user actions (quiz start, recommendation, save, etc.)
    await client.query(`
      CREATE TABLE IF NOT EXISTS analytics_events (
        id BIGSERIAL PRIMARY KEY,
        session_id UUID NOT NULL REFERENCES analytics_sessions(id) ON DELETE CASCADE,
        anon_id VARCHAR(64) NOT NULL,
        event_type VARCHAR(64) NOT NULL,
        event_data JSONB,
        page_path VARCHAR(512),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Daily aggregates table - pre-computed daily stats for fast dashboard queries
    await client.query(`
      CREATE TABLE IF NOT EXISTS analytics_daily_stats (
        stat_date DATE PRIMARY KEY,
        unique_visitors INTEGER DEFAULT 0,
        total_page_views INTEGER DEFAULT 0,
        total_sessions INTEGER DEFAULT 0,
        returning_visitors INTEGER DEFAULT 0,
        new_visitors INTEGER DEFAULT 0,
        quiz_starts INTEGER DEFAULT 0,
        recommendations_served INTEGER DEFAULT 0,
        saves INTEGER DEFAULT 0,
        avg_session_duration_seconds INTEGER DEFAULT 0,
        bounce_rate DECIMAL(5,2) DEFAULT 0,
        top_countries JSONB DEFAULT '[]',
        top_cities JSONB DEFAULT '[]',
        top_pages JSONB DEFAULT '[]',
        top_referrers JSONB DEFAULT '[]',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Hourly aggregates for real-time dashboard
    await client.query(`
      CREATE TABLE IF NOT EXISTS analytics_hourly_stats (
        stat_hour TIMESTAMPTZ PRIMARY KEY,
        unique_visitors INTEGER DEFAULT 0,
        total_page_views INTEGER DEFAULT 0,
        active_sessions INTEGER DEFAULT 0,
        quiz_starts INTEGER DEFAULT 0,
        recommendations_served INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Indexes for performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_page_views_session_id ON analytics_page_views(session_id);
      CREATE INDEX IF NOT EXISTS idx_page_views_anon_id ON analytics_page_views(anon_id);
      CREATE INDEX IF NOT EXISTS idx_page_views_created_at ON analytics_page_views(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_page_views_path ON analytics_page_views(path);
      CREATE INDEX IF NOT EXISTS idx_page_views_country ON analytics_page_views(country_code);
      CREATE INDEX IF NOT EXISTS idx_page_views_ip_hash ON analytics_page_views(ip_hash);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sessions_anon_id ON analytics_sessions(anon_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_last_seen ON analytics_sessions(last_seen DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_country ON analytics_sessions(country_code);
      CREATE INDEX IF NOT EXISTS idx_sessions_is_returning ON analytics_sessions(is_returning);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_events_session_id ON analytics_events(session_id);
      CREATE INDEX IF NOT EXISTS idx_events_anon_id ON analytics_events(anon_id);
      CREATE INDEX IF NOT EXISTS idx_events_type ON analytics_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_events_created_at ON analytics_events(created_at DESC);
    `);

    await client.query('COMMIT');
    console.log('✅ Analytics migration completed successfully');
    
    // Verify tables
    const tables = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name LIKE 'analytics_%'
      ORDER BY table_name
    `);
    console.log('Created tables:', tables.rows.map(r => r.table_name).join(', '));
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration().catch(() => process.exit(1));