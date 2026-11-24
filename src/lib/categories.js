export const CATEGORIES = {
  food:      { label: 'Food & Drinks', icon: '🍽️', color: '#f97316' },
  groceries: { label: 'Groceries',     icon: '🛒', color: '#22c55e' },
  travel:    { label: 'Travel',        icon: '🚕', color: '#3b82f6' },
  stay:      { label: 'Stay',          icon: '🏨', color: '#8b5cf6' },
  housing:   { label: 'Rent & Bills',  icon: '🏠', color: '#0ea5e9' },
  fun:       { label: 'Entertainment', icon: '🎬', color: '#ec4899' },
  shopping:  { label: 'Shopping',      icon: '🛍️', color: '#eab308' },
  sports:    { label: 'Sports',        icon: '⚽', color: '#14b8a6' },
  health:    { label: 'Health',        icon: '💊', color: '#ef4444' },
  other:     { label: 'Other',         icon: '📦', color: '#64748b' },
}

const KEYWORDS = {
  food: ['dinner', 'lunch', 'breakfast', 'brunch', 'snack', 'coffee', 'chai', 'tea', 'cafe', 'restaurant', 'pizza', 'burger',
    'biryani', 'dosa', 'idli', 'swiggy', 'zomato', 'food', 'drinks', 'beer', 'bar', 'pub', 'party', 'cake', 'ice cream',
    'thali', 'meals', 'juice', 'starbucks', 'dominos', 'kfc', 'mcd', 'truffles', 'chicken', 'paneer'],
  groceries: ['grocery', 'groceries', 'bigbasket', 'blinkit', 'zepto', 'instamart', 'dmart', 'vegetables', 'milk', 'fruits', 'supermarket'],
  travel: ['uber', 'ola', 'rapido', 'cab', 'taxi', 'auto', 'metro', 'bus', 'train', 'irctc', 'flight', 'petrol', 'diesel',
    'fuel', 'toll', 'parking', 'indigo', 'redbus', 'bike rent'],
  stay: ['hotel', 'airbnb', 'hostel', 'resort', 'homestay', 'oyo', 'room', 'stay', 'zostel'],
  housing: ['rent', 'electricity', 'bescom', 'water bill', 'wifi', 'internet', 'broadband', 'gas', 'cylinder', 'maintenance', 'maid', 'cook'],
  fun: ['movie', 'pvr', 'inox', 'bookmyshow', 'concert', 'netflix', 'spotify', 'hotstar', 'prime', 'game', 'bowling', 'trek', 'tickets'],
  shopping: ['amazon', 'flipkart', 'myntra', 'shopping', 'clothes', 'gift', 'decathlon'],
  sports: ['turf', 'football', 'cricket', 'badminton', 'court', 'playo', 'gym', 'jersey', 'shuttle'],
  health: ['medicine', 'pharmacy', 'doctor', 'hospital', 'apollo', 'medplus', 'clinic'],
}

/** Guess a category from free text. Returns a key of CATEGORIES. */
export function guessCategory(text = '') {
  const t = ` ${text.toLowerCase()} `
  let best = 'other'
  let bestLen = 0
  for (const [cat, words] of Object.entries(KEYWORDS)) {
    for (const w of words) {
      // whole-word match; longest keyword wins ("water bill" beats "bill")
      if (w.length > bestLen && new RegExp(`[^a-z]${w.replace(/ /g, '\\s+')}[^a-z]`).test(t)) {
        best = cat
        bestLen = w.length
      }
    }
  }
  return best
}

export const category = (key) => CATEGORIES[key] || CATEGORIES.other
