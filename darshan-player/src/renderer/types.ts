/**
 * Renderer Types - Shared type definitions for renderer processes
 */

// Import DarshanAPI from preload
import type { DarshanAPI } from '../preload/index'

// Extend Window interface with DARSHAN API. `hexmon` remains as a
// compatibility alias for existing integrations during the rename window.
declare global {
  interface Window {
    darshan: DarshanAPI
    hexmon: DarshanAPI
  }
}

// Make this file a module
export {}
