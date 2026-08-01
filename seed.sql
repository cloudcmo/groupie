-- Groupie: five hand-set launch grids (2026-08-01 through 2026-08-05).
-- Run once after schema.sql:  npm run seed:local  /  npm run seed:remote
-- After these, the cron (or POST /api/generate) takes over.

INSERT OR IGNORE INTO days (date, payload) VALUES
('2026-08-01', '{"groups":[
  {"name":"___ pudding","difficulty":0,"words":["YORKSHIRE","BLACK","RICE","SUMMER"]},
  {"name":"British sitcoms","difficulty":1,"words":["PORRIDGE","BLACKADDER","MIRANDA","SPACED"]},
  {"name":"What to call a bread roll, depending where you''re from","difficulty":2,"words":["COB","BAP","STOTTIE","BARM"]},
  {"name":"Cockney for parts of the body","difficulty":3,"words":["PLATES","BOAT","LOAF","MINCES"]}
],"trap":"LOAF looks like the bread rolls; PORRIDGE looks like breakfast alongside the puddings; BLACK reaches for BLACKADDER."}'),

('2026-08-02', '{"groups":[
  {"name":"Seen at the British seaside","difficulty":0,"words":["PIER","PROM","ARCADE","DONKEY"]},
  {"name":"Famous Davids","difficulty":1,"words":["BECKHAM","BOWIE","ATTENBOROUGH","HOCKNEY"]},
  {"name":"Doctor Who actors","difficulty":2,"words":["TENNANT","ECCLESTON","WHITTAKER","CAPALDI"]},
  {"name":"DOUBLE ___","difficulty":3,"words":["DECKER","CREAM","GLAZING","AGENT"]}
],"trap":"TENNANT sits between Doctor Who and the Pet Shop Boys; DECKER wants to be a bus at the seaside; CREAM wants to be an ice cream on the pier."}'),

('2026-08-03', '{"groups":[
  {"name":"Birds in a British garden","difficulty":0,"words":["ROBIN","WREN","SWIFT","STARLING"]},
  {"name":"Prime Ministers","difficulty":1,"words":["MAY","BLAIR","BROWN","MAJOR"]},
  {"name":"Cricket terms","difficulty":2,"words":["DUCK","GULLY","SLIP","MAIDEN"]},
  {"name":"Cockney money","difficulty":3,"words":["MONKEY","PONY","TON","SCORE"]}
],"trap":"DUCK reads as the fourth garden bird but is out for nought; MONKEY and PONY read as animals but are £500 and £25; MAY and BROWN read as a month and a colour; WREN could be Christopher."}'),

('2026-08-04', '{"groups":[
  {"name":"On the full English","difficulty":0,"words":["BACON","EGGS","BEANS","HASH BROWN"]},
  {"name":"Spice Girls","difficulty":1,"words":["POSH","SCARY","BABY","SPORTY"]},
  {"name":"Hair colours","difficulty":2,"words":["GINGER","BLONDE","AUBURN","MOUSY"]},
  {"name":"___ CASTLE","difficulty":3,"words":["BOUNCY","SAND","ELEPHANT","BARNARD"]}
],"trap":"Four Spice Girls are on the grid but the fifth chair is empty: GINGER is filed under hair colours. ELEPHANT and SAND read as a zoo and a beach until the castles turn up."}'),

('2026-08-05', '{"groups":[
  {"name":"Biscuits for dunking","difficulty":0,"words":["DIGESTIVE","RICH TEA","HOBNOB","BOURBON"]},
  {"name":"On the Monopoly board","difficulty":1,"words":["MAYFAIR","STRAND","ANGEL","OLD KENT ROAD"]},
  {"name":"Ways to say toilet","difficulty":2,"words":["LOO","KHAZI","LAV","PRIVY"]},
  {"name":"___ ROLL","difficulty":3,"words":["BOG","DRUM","SAUSAGE","SWISS"]}
],"trap":"BOG sits with the toilets until the rolls arrive; BOURBON could be whisky or royalty but is a biscuit; SWISS could be a tube station; ANGEL could be several things and is a Monopoly square."}');

INSERT OR IGNORE INTO categories (name, date) VALUES
('___ pudding', '2026-08-01'),
('british sitcoms', '2026-08-01'),
('what to call a bread roll, depending where you''re from', '2026-08-01'),
('cockney for parts of the body', '2026-08-01'),
('seen at the british seaside', '2026-08-02'),
('famous davids', '2026-08-02'),
('doctor who actors', '2026-08-02'),
('double ___', '2026-08-02'),
('birds in a british garden', '2026-08-03'),
('prime ministers', '2026-08-03'),
('cricket terms', '2026-08-03'),
('cockney money', '2026-08-03'),
('on the full english', '2026-08-04'),
('spice girls', '2026-08-04'),
('hair colours', '2026-08-04'),
('___ castle', '2026-08-04'),
('biscuits for dunking', '2026-08-05'),
('on the monopoly board', '2026-08-05'),
('ways to say toilet', '2026-08-05'),
('___ roll', '2026-08-05');
