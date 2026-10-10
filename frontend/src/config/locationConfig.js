/**
 * Sahayta Setu - Default Location Configuration
 * Centralized constant for default state selection across dropdowns.
 */

export const DEFAULT_STATE = 'Uttar Pradesh';
export const DEFAULT_STATE_CODE = 'UP';
export const DEFAULT_DISTRICT = 'Gautam Buddha Nagar';

export const STATE_CODE_MAP = {
  'Uttarakhand': 'UK',
  'Uttar Pradesh': 'UP',
  'Himachal Pradesh': 'HP',
  'Jammu and Kashmir': 'JK',
  'Delhi': 'DL',
  'Punjab': 'PB',
  'Haryana': 'HR',
  'Rajasthan': 'RJ',
  'Bihar': 'BR',
  'West Bengal': 'WB',
  'Assam': 'AS',
  'Karnataka': 'KA',
  'Maharashtra': 'MH',
  'Kerala': 'KL',
  'Tamil Nadu': 'TN',
  'Gujarat': 'GJ',
  'Madhya Pradesh': 'MP',
  'Odisha': 'OD'
};

export function getStateCode(stateName) {
  return STATE_CODE_MAP[stateName] || null;
}
