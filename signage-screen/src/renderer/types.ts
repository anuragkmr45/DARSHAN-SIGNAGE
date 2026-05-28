/**
 * Renderer Types - Shared type definitions for renderer processes
 */

// Import HexmonAPI from preload
import type { HexmonAPI } from '../preload/index'

// Extend Window interface with hexmon API
declare global {
  interface Window {
    hexmon: HexmonAPI
  }
}

// Make this file a module
export {}

