import abaya from '@/assets/products/abaya.png';
import babycloth from '@/assets/products/baby-cloth.png';
import babydress from '@/assets/products/baby-dress.png';
import babypant from '@/assets/products/baby-pant.png';
import babytshirt from '@/assets/products/baby-tshirt.png';
import bedsheet from '@/assets/products/bed-sheet.png';
import blanket from '@/assets/products/blanket.png';
import bra from '@/assets/products/bra.png';
import cap from '@/assets/products/cap.png';
import carpet from '@/assets/products/carpet.png';
import comforter from '@/assets/products/comforter.png';
import coverall from '@/assets/products/coverall.png';
import curtain from '@/assets/products/curtain.png';
import duvetcover from '@/assets/products/duvet-cover.png';
import ghutra from '@/assets/products/ghutra.png';
import jacket from '@/assets/products/jacket.png';
import jeans from '@/assets/products/jeans.png';
import kandoora from '@/assets/products/kandoora.png';
import ladiessuit from '@/assets/products/ladies-suit.png';
import militarydress from '@/assets/products/military-dress.png';
import partydress from '@/assets/products/party-dress.png';
import pillow from '@/assets/products/pillow.png';
import pillowcover from '@/assets/products/pillow-cover.png';
import salawarqamees from '@/assets/products/salawar-qamees.png';
import saree from '@/assets/products/saree.png';
import shela from '@/assets/products/shela.png';
import shirt from '@/assets/products/shirt.png';
import shoes from '@/assets/products/shoes.png';
import shorts from '@/assets/products/shorts.png';
import skirt from '@/assets/products/skirt.png';
import socks from '@/assets/products/socks.png';
import suit from '@/assets/products/suit.png';
import sweater from '@/assets/products/sweater.png';
import tablecloth from '@/assets/products/table-cloth.png';
import towel from '@/assets/products/towel.png';
import trackpant from '@/assets/products/track-pant.png';
import tshirt from '@/assets/products/tshirt.png';
import underwear from '@/assets/products/underwear.png';
import vest from '@/assets/products/vest.png';
import wezarlungi from '@/assets/products/wezar-lungi.png';

const productImageMap: Record<string, string> = {
  // Arabic Clothes
  'Abaya': abaya,
  'Ghutra': ghutra,
  'Agal': ghutra,
  'Bisht': kandoora,
  'Jalabiya': kandoora,
  'Niqab': shela,
  'Kandoora/Thob': kandoora,
  'Shela': shela,
  
  // Men's Clothes
  'Shirt/Blouse': shirt,
  'T-Shirt (Normal)': tshirt,
  'T-Shirt (Dry Clean)': tshirt,
  'Jeans Pant/Trouser': jeans,
  'Track Pant (Normal)': trackpant,
  'Track Pant (Dry Clean)': trackpant,
  'Jacket': jacket,
  'Sweater': sweater,
  'Short': shorts,
  'Suit/Coat (Normal)': suit,
  'Suit/Coat (Dry Clean)': suit,
  'Polo Shirt': shirt,
  'Hoodie': sweater,
  'Formal Pants': jeans,
  'Wezar/Lungi': wezarlungi,
  'Fanela/Vest': vest,
  'Underwear': underwear,
  
  // Ladies' Clothes
  'Ladies Bras': bra,
  'Ladies Suit': ladiessuit,
  'Saree': saree,
  'Salawar Qamees': salawarqamees,
  'Ladies Pusthan': ladiessuit,
  'Party Dress (Female)': partydress,
  'Skirt': skirt,
  'Blouse': shirt,
  'Evening Gown': partydress,
  'Kaftan': abaya,
  'Lehenga': saree,
  
  // Baby Clothes
  'Baby T-Shirt': babytshirt,
  'Baby Pant': babypant,
  'Baby Cloth': babycloth,
  'Baby Dress': babydress,
  'Baby Romper': babycloth,
  'Baby Blanket': blanket,
  'Baby Jacket': jacket,
  
  // Linens
  'Pillow Cover': pillowcover,
  'Pillow': pillow,
  'Bed Sheet (Single)': bedsheet,
  'Bed Sheet (Double)': bedsheet,
  'Bed Sheet (King)': bedsheet,
  'Bed Sheet': bedsheet,
  'Duvet Cover': duvetcover,
  'Towel (Small)': towel,
  'Towel (Large)': towel,
  'Towel': towel,
  'Blanket (Single)': blanket,
  'Blanket (Double)': blanket,
  'Blanket': blanket,
  'Comforter (Small)': comforter,
  'Comforter (Large)': comforter,
  'Comfort (Large)': comforter,
  'Comfort (Small)': comforter,
  'Table Cloth (Small)': tablecloth,
  'Table Cloth (Large)': tablecloth,
  'Curtain (per meter)': curtain,
  'Curtain/Window Screen': curtain,
  'Mattress Cover': bedsheet,
  
  // General Items
  'Coveral': coverall,
  'Military Dress': militarydress,
  'Party Dress (Male)': suit,
  'Socks (pair)': socks,
  'Socks': socks,
  'Cap/Hat': cap,
  'Cap': cap,
  'Tie': suit,
  'Scarf': shela,
  'Gloves (pair)': vest,
  'Belt': jeans,
  
  // Shoes, Carpets & More
  'Shoes (Regular)': shoes,
  'Shoes (Premium)': shoes,
  'Shoes': shoes,
  'Sandals': shoes,
  'Boots': shoes,
  'Sneakers': shoes,
  'Carpet (per SQ MTR)': carpet,
  'Rug (Small)': carpet,
  'Rug (Medium)': carpet,
  'Rug (Large)': carpet,
  'Prayer Mat': carpet,
  'Bag/Purse': ladiessuit,
  'Leather Jacket': jacket,
  'Sofa Cover (per seat)': curtain,
  'Car Seat Cover': curtain,
};

export function getProductImage(productName: string): string | null {
  const normalizedName = productName.split(' (')[0].trim();
  
  // Try exact match first
  if (productImageMap[productName]) {
    return productImageMap[productName];
  }
  
  // Try normalized name (without parentheses)
  if (productImageMap[normalizedName]) {
    return productImageMap[normalizedName];
  }
  
  // Try substring matching
  for (const key of Object.keys(productImageMap)) {
    if (productName.toLowerCase().includes(key.toLowerCase()) || 
        key.toLowerCase().includes(productName.toLowerCase())) {
      return productImageMap[key];
    }
  }
  
  return null;
}

export default productImageMap;
