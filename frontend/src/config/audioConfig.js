/**
 * Sahayta Setu - Emergency Alert Audio Configuration
 * Single centralized audio source constant for emergency alerts.
 * Audio can be extended per language in the future while keeping ALERT_AUDIO_SRC as default.
 */

export const ALERT_AUDIO_SRC = '/EmergencyAlert-Hindi.mp3';

export const ALERT_AUDIO_MAP = {
  hi: '/EmergencyAlert-Hindi.mp3',
  en: '/EmergencyAlert-Hindi.mp3'
};

export function getAlertAudio(lang = 'hi') {
  return ALERT_AUDIO_MAP[lang] || ALERT_AUDIO_SRC;
}
