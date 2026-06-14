// 球队 → ISO 国家码（flagcdn 图片，跨平台可靠）
const CC = {
  Mexico: 'mx', 'South Africa': 'za', 'South Korea': 'kr', Czechia: 'cz', Canada: 'ca',
  Bosnia: 'ba', Qatar: 'qa', Switzerland: 'ch', Brazil: 'br', Morocco: 'ma',
  Haiti: 'ht', Scotland: 'gb-sct', USA: 'us', Paraguay: 'py', Australia: 'au',
  Turkey: 'tr', Germany: 'de', Curacao: 'cw', "Cote d'Ivoire": 'ci', Ecuador: 'ec',
  Netherlands: 'nl', Japan: 'jp', Sweden: 'se', Tunisia: 'tn', Belgium: 'be',
  Egypt: 'eg', Iran: 'ir', 'New Zealand': 'nz', Spain: 'es', 'Cape Verde': 'cv',
  'Saudi Arabia': 'sa', Uruguay: 'uy', France: 'fr', Senegal: 'sn', Iraq: 'iq',
  Norway: 'no', Argentina: 'ar', Algeria: 'dz', Austria: 'at', Jordan: 'jo',
  Portugal: 'pt', 'DR Congo': 'cd', Uzbekistan: 'uz', Colombia: 'co', England: 'gb-eng',
  Croatia: 'hr', Ghana: 'gh', Panama: 'pa',
}
export const flag = (team) => CC[team] ? `https://flagcdn.com/w80/${CC[team]}.png` : ''
