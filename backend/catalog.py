"""
Static reference data for EcoScrap.

Everything the platform "knows" before any booking exists lives here:
  - CATEGORIES : what we accept, the published rate card, typical weights,
                 CO2 factors and Green Points rules
  - SLOTS      : pickup time windows
  - RECYCLERS  : real MPCB-authorised e-waste dismantlers/recyclers (MMR)
  - COLLECTORS : demo pickup partners (fictional people)
  - REWARDS    : what Green Points can be redeemed for
"""

# --------------------------------------------------------------------------
# Item categories and the published rate card
# --------------------------------------------------------------------------
# rates are in Rupees per item, by condition. Everyone sees the same numbers.
# co2_factor = kg CO2e avoided per kg recycled. These are ILLUSTRATIVE factors
# for the project demo and are labelled as estimates in the UI.
CONDITIONS = {
    "working": "Working",
    "not_working": "Not working",
    "broken": "Broken / parts missing",
}

CATEGORIES = {
    "phone": {
        "name": "Mobile phone", "icon": "smartphone", "kg": 0.2, "co2_factor": 3.0,
        "rates": {"working": 350, "not_working": 120, "broken": 60},
        "examples": "Smartphones, feature phones, dead or cracked phones",
        "hazard": "Lithium battery, lead solder, small amounts of gold and copper",
    },
    "laptop": {
        "name": "Laptop / desktop", "icon": "laptop", "kg": 2.5, "co2_factor": 2.5,
        "rates": {"working": 1500, "not_working": 500, "broken": 300},
        "examples": "Laptops, CPUs, all-in-ones, MacBooks",
        "hazard": "Battery pack, circuit boards, brominated plastics",
    },
    "tablet": {
        "name": "Tablet / e-reader", "icon": "tablet", "kg": 0.5, "co2_factor": 2.5,
        "rates": {"working": 600, "not_working": 200, "broken": 100},
        "examples": "iPads, Android tablets, Kindles",
        "hazard": "Lithium battery, display glass with indium",
    },
    "display": {
        "name": "TV / monitor", "icon": "monitor", "kg": 7.0, "co2_factor": 1.5,
        "rates": {"working": 500, "not_working": 250, "broken": 150},
        "examples": "LED/LCD TVs, computer monitors, old CRT sets",
        "hazard": "CRTs contain leaded glass; older LCDs can contain mercury lamps",
    },
    "battery": {
        "name": "Batteries & power banks", "icon": "battery-charging", "kg": 0.3, "co2_factor": 1.8,
        "rates": {"working": 30, "not_working": 30, "broken": 20},
        "examples": "Power banks, laptop batteries, rechargeable packs",
        "hazard": "Fire risk if crushed; contains cobalt, nickel, lithium",
    },
    "cables": {
        "name": "Cables & chargers", "icon": "cable", "kg": 0.5, "co2_factor": 2.0,
        "rates": {"working": 40, "not_working": 40, "broken": 30},
        "examples": "A bundle of chargers, adapters, wires (about 0.5 kg)",
        "hazard": "PVC insulation releases toxic smoke when burnt for copper",
    },
    "accessory": {
        "name": "Accessories & parts", "icon": "cpu", "kg": 0.4, "co2_factor": 1.5,
        "rates": {"working": 60, "not_working": 25, "broken": 15},
        "examples": "Keyboards, mice, routers, hard drives, RAM, GPUs",
        "hazard": "Circuit boards with lead solder and flame retardants",
    },
    "printer": {
        "name": "Printer / scanner", "icon": "printer", "kg": 6.0, "co2_factor": 1.2,
        "rates": {"working": 250, "not_working": 100, "broken": 60},
        "examples": "Inkjet and laser printers, scanners, fax machines",
        "hazard": "Toner dust and ink cartridges",
    },
    "appliance": {
        "name": "Small appliances", "icon": "plug", "kg": 1.5, "co2_factor": 1.2,
        "rates": {"working": 120, "not_working": 60, "broken": 40},
        "examples": "Mixers, irons, kettles, hair dryers, trimmers",
        "hazard": "Copper motors and mixed plastics",
    },
    "large": {
        "name": "Fridge / AC / washing machine", "icon": "refrigerator", "kg": 40.0, "co2_factor": 1.0,
        "rates": {"working": 2000, "not_working": 1200, "broken": 900},
        "examples": "Refrigerators, air conditioners, washing machines",
        "hazard": "Refrigerant gases are powerful greenhouse gases if vented",
    },
}

SLOTS = ["09:00-12:00", "12:00-15:00", "15:00-18:00", "18:00-20:00"]

# Green Points rules (platform reward points, NOT carbon credits)
POINTS_PER_KG = 10
POINTS_PER_PICKUP = 50

# 1 km in an average petrol car ~ 0.17 kg CO2 (used only for a relatable comparison)
CAR_KG_CO2_PER_KM = 0.17

# Mumbai Metropolitan Region service area (rough bounding box)
SERVICE_BBOX = {"lat_min": 18.85, "lat_max": 19.75, "lng_min": 72.70, "lng_max": 73.30}

# --------------------------------------------------------------------------
# Authorised recyclers (REAL entries, MPCB list of authorised e-waste
# dismantlers and recyclers in Maharashtra). Only entries whose validity runs
# past 2026 are used. Map positions are approximate area centres.
# Source PDF: https://www.mpcb.gov.in/sites/default/files/List%20of%20Authorized%20E-waste%20Dismantlers%20and%20Recyclers%20in%20Maharashtra.pdf
# --------------------------------------------------------------------------
MPCB_SOURCE = ("https://www.mpcb.gov.in/sites/default/files/"
               "List%20of%20Authorized%20E-waste%20Dismantlers%20and%20Recyclers%20in%20Maharashtra.pdf")

RECYCLERS = [
    {"id": "RC-01", "name": "Mac Fix Station", "type": "Dismantler", "area": "Khar / Bandra",
     "address": "Office No. 201, Makhija Arcade, 35th Road, Khar Bandra Linking Road, Bandra, Mumbai 400052",
     "auth": "MPCB/RO(HQ)/HSMD/Autho/21/EW-31", "valid_to": "2027-02-28", "capacity_tpa": 800,
     "lat": 19.0655, "lng": 72.8345},
    {"id": "RC-02", "name": "THE2BROS", "type": "Dismantler", "area": "Chandivali",
     "address": "70 AS Kurla Andheri Road, Opp. Jarimari Temple, Chandivali, Mumbai 400072",
     "auth": "MPCB/RO(HQ)/HSMD/Autho/21/EW-46", "valid_to": "2027-03-31", "capacity_tpa": 275,
     "lat": 19.0985, "lng": 72.8835},
    {"id": "RC-03", "name": "Spas Computers Pvt. Ltd.", "type": "Dismantler", "area": "Jogeshwari East",
     "address": "7 & 12, Hema Industrial Estate, Sarvodaya Nagar, Rajmata Jijai Road, Jogeshwari (E), Mumbai",
     "auth": "MPCB/RO(HQ)/HSMD/Autho/22/EW-27", "valid_to": "2027-07-31", "capacity_tpa": 500,
     "lat": 19.1385, "lng": 72.8605},
    {"id": "RC-04", "name": "Savita Barrels", "type": "Dismantler", "area": "Ghatkopar",
     "address": "Sr. No. 7, Mihili, Opp. Jangleshwar Mahadev Mandir, J.M.M. Road, Ghatkopar, Mumbai 400086",
     "auth": "MPCB/RO(HQ)/HSMD/Autho/23/EW-58", "valid_to": "2028-03-31", "capacity_tpa": 125,
     "lat": 19.0905, "lng": 72.9110},
    {"id": "RC-05", "name": "Recycle Mitra Eco Care LLP", "type": "Dismantler", "area": "Wagle Estate, Thane",
     "address": "Plot No. A-368, M H Industries, Wagle Industrial Estate, Thane",
     "auth": "MPCB/RO(HQ)/HSMD/Autho/23/EW-39", "valid_to": "2027-12-31", "capacity_tpa": 100,
     "lat": 19.2005, "lng": 72.9555},
    {"id": "RC-06", "name": "ECO Friend Industries", "type": "Dismantler & Recycler", "area": "Pawane, Navi Mumbai",
     "address": "Plot No. A-205, TTC Industrial Area, MIDC Pawane, Navi Mumbai",
     "auth": "MPCB/RO(HQ)/HSMD/Autho/22/EW-05", "valid_to": "2027-05-31", "capacity_tpa": 1000,
     "lat": 19.0880, "lng": 73.0150},
    {"id": "RC-07", "name": "Reteck Envirotech Pvt. Ltd.", "type": "Dismantler", "area": "MIDC Taloja",
     "address": "Plot No. 4 A, MIDC Taloja, Tal. Panvel, Dist. Raigad",
     "auth": "MPCB/RO(HQ)/HSMD/Autho/22/EW-18", "valid_to": "2027-06-30", "capacity_tpa": 2500,
     "lat": 19.0685, "lng": 73.1120},
]

# --------------------------------------------------------------------------
# Demo pickup partners (fictional people for the project demo).
# Each collector signs in with their own ID and PIN. demo_pin is only used to
# create the first PIN; it is stored as a hash in the staff table.
# --------------------------------------------------------------------------
COLLECTORS = [
    {"id": "CL-101", "demo_pin": "4821", "name": "Rahul Pawar", "vehicle": "Electric bike + cargo box", "rating": 4.9,
     "hub": "Andheri", "lat": 19.1197, "lng": 72.8468},
    {"id": "CL-102", "demo_pin": "7364", "name": "Pooja Kadam", "vehicle": "Electric 3-wheeler", "rating": 4.8,
     "hub": "Bandra", "lat": 19.0596, "lng": 72.8295},
    {"id": "CL-103", "demo_pin": "2590", "name": "Sameer Shaikh", "vehicle": "Mini tempo", "rating": 4.7,
     "hub": "Ghatkopar", "lat": 19.0860, "lng": 72.9081},
    {"id": "CL-104", "demo_pin": "9137", "name": "Imran Qureshi", "vehicle": "Mini tempo", "rating": 4.8,
     "hub": "Thane", "lat": 19.2183, "lng": 72.9781},
    {"id": "CL-105", "demo_pin": "6408", "name": "Neha Sawant", "vehicle": "Electric 3-wheeler", "rating": 4.9,
     "hub": "Dadar", "lat": 19.0178, "lng": 72.8478},
]

# --------------------------------------------------------------------------
# Green Points reward catalogue
# --------------------------------------------------------------------------
REWARDS = [
    {"id": "RW-1", "name": "Tulsi or money-plant sapling", "points": 150, "icon": "sprout",
     "detail": "Delivered with your next pickup"},
    {"id": "RW-2", "name": "Bamboo toothbrush set (4)", "points": 300, "icon": "leaf",
     "detail": "Plastic-free daily swap"},
    {"id": "RW-3", "name": "Jute shopping bag", "points": 400, "icon": "package",
     "detail": "Replaces about 500 plastic bags over its life"},
    {"id": "RW-4", "name": "Steel water bottle", "points": 900, "icon": "wine",
     "detail": "750 ml, insulated"},
    {"id": "RW-5", "name": "₹100 off a refurbished gadget", "points": 1000, "icon": "smartphone",
     "detail": "Voucher for a partner refurbisher"},
    {"id": "RW-6", "name": "Plant 5 trees in your name", "points": 1500, "icon": "tree-pine",
     "detail": "Through a city tree-plantation drive"},
]
