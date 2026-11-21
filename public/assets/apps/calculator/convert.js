/*
 * Calculator's Converter and Date modes: unit tables (each unit's size in its category's base unit, as exact decimal
 * text, "a/b" for fractions) and date arithmetic on calendar days (no times, no time zones: a date is a day).
 */
(function () {
  'use strict';

  const D = window.CalcDec;

  // [id, name, symbol, factor]
  const UNITS = {
    length: { name: 'Length', units: [
      ['nm', 'Nanometres', 'nm', '1e-9'], ['um', 'Micrometres', 'µm', '1e-6'], ['mm', 'Millimetres', 'mm', '0.001'],
      ['cm', 'Centimetres', 'cm', '0.01'], ['m', 'Metres', 'm', '1'], ['km', 'Kilometres', 'km', '1000'],
      ['in', 'Inches', 'in', '0.0254'], ['ft', 'Feet', 'ft', '0.3048'], ['yd', 'Yards', 'yd', '0.9144'],
      ['mi', 'Miles', 'mi', '1609.344'], ['nmi', 'Nautical miles', 'nmi', '1852'],
    ], from: 'm', to: 'ft' },
    area: { name: 'Area', units: [
      ['mm2', 'Square millimetres', 'mm²', '1e-6'], ['cm2', 'Square centimetres', 'cm²', '1e-4'], ['m2', 'Square metres', 'm²', '1'],
      ['ha', 'Hectares', 'ha', '10000'], ['km2', 'Square kilometres', 'km²', '1e6'], ['in2', 'Square inches', 'in²', '0.00064516'],
      ['ft2', 'Square feet', 'ft²', '0.09290304'], ['yd2', 'Square yards', 'yd²', '0.83612736'], ['ac', 'Acres', 'ac', '4046.8564224'],
      ['mi2', 'Square miles', 'mi²', '2589988.110336'],
    ], from: 'm2', to: 'ft2' },
    volume: { name: 'Volume', units: [
      ['ml', 'Millilitres', 'mL', '0.001'], ['l', 'Litres', 'L', '1'], ['m3', 'Cubic metres', 'm³', '1000'],
      ['cm3', 'Cubic centimetres', 'cm³', '0.001'], ['in3', 'Cubic inches', 'in³', '0.016387064'], ['ft3', 'Cubic feet', 'ft³', '28.316846592'],
      ['tsp', 'Teaspoons (US)', 'tsp', '0.00492892159375'], ['tbsp', 'Tablespoons (US)', 'tbsp', '0.01478676478125'],
      ['floz', 'Fluid ounces (US)', 'fl oz', '0.0295735295625'], ['cup', 'Cups (US)', 'cup', '0.2365882365'],
      ['pt', 'Pints (US)', 'pt', '0.473176473'], ['qt', 'Quarts (US)', 'qt', '0.946352946'], ['gal', 'Gallons (US)', 'gal', '3.785411784'],
      ['ptuk', 'Pints (UK)', 'pt', '0.56826125'], ['galuk', 'Gallons (UK)', 'gal', '4.54609'],
    ], from: 'l', to: 'gal' },
    mass: { name: 'Weight and mass', units: [
      ['mg', 'Milligrams', 'mg', '1e-6'], ['g', 'Grams', 'g', '0.001'], ['kg', 'Kilograms', 'kg', '1'], ['t', 'Tonnes', 't', '1000'],
      ['ct', 'Carats', 'ct', '0.0002'], ['oz', 'Ounces', 'oz', '0.028349523125'], ['lb', 'Pounds', 'lb', '0.45359237'],
      ['st', 'Stones', 'st', '6.35029318'], ['tnus', 'Short tons (US)', 'ton', '907.18474'], ['tnuk', 'Long tons (UK)', 'ton', '1016.0469088'],
    ], from: 'kg', to: 'lb' },
    temperature: { name: 'Temperature', units: [
      ['c', 'Celsius', '°C'], ['f', 'Fahrenheit', '°F'], ['k', 'Kelvin', 'K'],
    ], from: 'c', to: 'f' },
    speed: { name: 'Speed', units: [
      ['ms', 'Metres per second', 'm/s', '1'], ['kmh', 'Kilometres per hour', 'km/h', '1000/3600'], ['mph', 'Miles per hour', 'mph', '1609.344/3600'],
      ['fts', 'Feet per second', 'ft/s', '0.3048'], ['kn', 'Knots', 'kn', '1852/3600'],
    ], from: 'kmh', to: 'mph' },
    time: { name: 'Time', units: [
      ['us', 'Microseconds', 'µs', '1e-6'], ['ms', 'Milliseconds', 'ms', '0.001'], ['s', 'Seconds', 's', '1'], ['min', 'Minutes', 'min', '60'],
      ['h', 'Hours', 'h', '3600'], ['d', 'Days', 'd', '86400'], ['wk', 'Weeks', 'wk', '604800'], ['yr', 'Years (365 days)', 'yr', '31536000'],
    ], from: 'h', to: 'min' },
    data: { name: 'Data', units: [
      ['bit', 'Bits', 'bit', '1/8'], ['B', 'Bytes', 'B', '1'], ['KB', 'Kilobytes', 'KB', '1000'], ['MB', 'Megabytes', 'MB', '1e6'],
      ['GB', 'Gigabytes', 'GB', '1e9'], ['TB', 'Terabytes', 'TB', '1e12'], ['KiB', 'Kibibytes', 'KiB', '1024'], ['MiB', 'Mebibytes', 'MiB', '1048576'],
      ['GiB', 'Gibibytes', 'GiB', '1073741824'], ['TiB', 'Tebibytes', 'TiB', '1099511627776'], ['kbit', 'Kilobits', 'kbit', '125'],
      ['Mbit', 'Megabits', 'Mbit', '125000'], ['Gbit', 'Gigabits', 'Gbit', '125000000'],
    ], from: 'GB', to: 'GiB' },
    energy: { name: 'Energy', units: [
      ['j', 'Joules', 'J', '1'], ['kj', 'Kilojoules', 'kJ', '1000'], ['cal', 'Calories', 'cal', '4.184'], ['kcal', 'Kilocalories', 'kcal', '4184'],
      ['wh', 'Watt-hours', 'Wh', '3600'], ['kwh', 'Kilowatt-hours', 'kWh', '3600000'], ['ev', 'Electronvolts', 'eV', '1.602176634e-19'],
      ['btu', 'British thermal units', 'BTU', '1055.05585262'], ['ftlb', 'Foot-pounds', 'ft·lbf', '1.3558179483314004'],
    ], from: 'kcal', to: 'kj' },
    power: { name: 'Power', units: [
      ['w', 'Watts', 'W', '1'], ['kw', 'Kilowatts', 'kW', '1000'], ['mw', 'Megawatts', 'MW', '1e6'],
      ['hp', 'Horsepower (mechanical)', 'hp', '745.69987158227022'], ['ps', 'Horsepower (metric)', 'PS', '735.49875'],
      ['btuh', 'BTU per hour', 'BTU/h', '0.29307107017'],
    ], from: 'kw', to: 'hp' },
    pressure: { name: 'Pressure', units: [
      ['pa', 'Pascals', 'Pa', '1'], ['kpa', 'Kilopascals', 'kPa', '1000'], ['mpa', 'Megapascals', 'MPa', '1e6'], ['bar', 'Bars', 'bar', '100000'],
      ['mbar', 'Millibars', 'mbar', '100'], ['atm', 'Atmospheres', 'atm', '101325'], ['psi', 'Pounds per square inch', 'psi', '6894.757293168'],
      ['mmhg', 'Millimetres of mercury', 'mmHg', '133.322387415'], ['inhg', 'Inches of mercury', 'inHg', '3386.389'],
    ], from: 'bar', to: 'psi' },
    angle: { name: 'Angle', units: [
      ['deg', 'Degrees', '°', '1'], ['rad', 'Radians', 'rad', '180/pi'], ['grad', 'Gradians', 'grad', '0.9'],
      ['arcmin', 'Minutes of arc', '′', '1/60'], ['arcsec', 'Seconds of arc', '″', '1/3600'], ['turn', 'Turns', 'turn', '360'],
    ], from: 'deg', to: 'rad' },
  };

  function factor(text) {
    const [a, b] = text.split('/');
    const num = D.parse(a);
    if (!b) return num;
    return num.div(b === 'pi' ? D.PI : D.parse(b));
  }
  const unitOf = (cat, id) => UNITS[cat].units.find((u) => u[0] === id);

  /** value (Dec) from one unit to another of the same category. */
  function convert(cat, value, from, to) {
    if (from === to) return value;
    if (cat === 'temperature') return fromKelvin(toKelvin(value, from), to);
    const a = factor(unitOf(cat, from)[3]);
    const b = factor(unitOf(cat, to)[3]);
    return value.mul(a).div(b);
  }
  const K0 = D.parse('273.15');
  const NINE5 = D.of(9, 0).div(D.of(5, 0));
  const F32 = D.of(32, 0);
  function toKelvin(v, u) {
    if (u === 'k') return v;
    if (u === 'c') return v.add(K0);
    return v.sub(F32).div(NINE5).add(K0);
  }
  function fromKelvin(v, u) {
    if (u === 'k') return v;
    if (u === 'c') return v.sub(K0);
    return v.sub(K0).mul(NINE5).add(F32);
  }

  // ------------------------------------------------------------------ dates
  // A date is { y, m (0-11), d }; worked on as UTC midnights so no clock change gets in the way.
  const utc = (x) => Date.UTC(x.y, x.m, x.d);
  const fromUtc = (t) => { const d = new Date(t); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() }; };
  const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const today = () => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth(), d: n.getDate() }; };

  /** Days between two dates, and the same as years, months, weeks and days (from the earlier one). */
  function difference(a, b) {
    let x = a;
    let y = b;
    if (utc(x) > utc(y)) { x = b; y = a; }
    const days = Math.round((utc(y) - utc(x)) / 86400000);
    let years = y.y - x.y;
    let months = y.m - x.m;
    let d = y.d - x.d;
    if (d < 0) { months -= 1; d += daysIn(y.m === 0 ? y.y - 1 : y.y, (y.m + 11) % 12); }
    if (months < 0) { years -= 1; months += 12; }
    return { days, years, months, weeks: Math.floor(d / 7), rest: d % 7 };
  }
  /** A date moved by years, months and days (sign -1 subtracts); the day is kept within the month (31 Jan + 1 month = 28/29 Feb). */
  function add(x, years, months, days, sign) {
    const s = sign < 0 ? -1 : 1;
    const total = x.m + s * (years * 12 + months);
    const y = x.y + Math.floor(total / 12);
    const m = ((total % 12) + 12) % 12;
    const d = Math.min(x.d, daysIn(y, m));
    return fromUtc(Date.UTC(y, m, d) + s * days * 86400000);
  }

  window.CalcConvert = { UNITS, convert, unitOf, dates: { difference, add, today, daysIn, utc, fromUtc } };
})();
