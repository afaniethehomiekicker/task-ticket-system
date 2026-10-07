// Cities and towns of Pakistan for the city pickers — every province and
// territory: Punjab, Sindh, Khyber Pakhtunkhwa, Balochistan, Islamabad
// Capital Territory, Azad Jammu & Kashmir and Gilgit-Baltistan (district
// headquarters plus other notable towns). A place that isn't listed can
// still be typed in (see CitySelect), so this doesn't need to be exhaustive.

const CITIES = [
  // Islamabad Capital Territory
  'Islamabad',

  // Punjab
  'Lahore', 'Faisalabad', 'Rawalpindi', 'Gujranwala', 'Multan', 'Sialkot',
  'Bahawalpur', 'Sargodha', 'Sheikhupura', 'Jhang', 'Rahim Yar Khan',
  'Gujrat', 'Kasur', 'Sahiwal', 'Okara', 'Wah Cantonment', 'Dera Ghazi Khan',
  'Mandi Bahauddin', 'Chiniot', 'Kamoke', 'Burewala', 'Jhelum', 'Sadiqabad',
  'Khanewal', 'Hafizabad', 'Muzaffargarh', 'Khanpur', 'Gojra', 'Bahawalnagar',
  'Muridke', 'Pakpattan', 'Jaranwala', 'Chishtian', 'Daska', 'Mianwali',
  'Kamalia', 'Ahmedpur East', 'Vehari', 'Wazirabad', 'Attock', 'Khushab',
  'Kot Addu', 'Taxila', 'Chakwal', 'Narowal', 'Lodhran', 'Layyah', 'Bhakkar',
  'Toba Tek Singh', 'Nankana Sahib', 'Rajanpur', 'Pattoki', 'Haroonabad',
  'Hasilpur', 'Arifwala', 'Jampur', 'Samundri', 'Mian Channu', 'Shorkot',
  'Kharian', 'Lalamusa', 'Pind Dadan Khan', 'Murree', 'Gujar Khan',
  'Chichawatni', 'Depalpur', 'Renala Khurd', 'Kabirwala', 'Shujabad',
  'Jalalpur Pirwala', 'Mailsi', 'Fort Abbas', 'Minchinabad', 'Yazman',
  'Liaquatpur', 'Taunsa', 'Fazilpur', 'Kot Momin', 'Bhalwal', 'Sillanwali',
  'Shahpur', 'Phalia', 'Sarai Alamgir', 'Dina', 'Talagang', 'Fateh Jang',
  'Hasan Abdal', 'Pindi Gheb', 'Kahuta', 'Kallar Syedan',
  'Sambrial', 'Pasrur', 'Zafarwal', 'Shakargarh', 'Nowshera Virkan',
  'Ferozwala', 'Raiwind', 'Chunian', 'Kot Radha Kishan', 'Sangla Hill',
  'Safdarabad', 'Shahkot', 'Tandlianwala', 'Chak Jhumra', 'Pir Mahal',
  'Ahmadpur Sial', 'Athara Hazari', 'Kot Chutta', 'Ali Pur', 'Isa Khel',
  'Piplan', 'Kalabagh', 'Noorpur Thal', 'Darya Khan', 'Kalurkot', 'Chaubara',
  'Karor Lal Esan', 'Dunyapur', 'Kehror Pakka', 'Bhera', 'Kot Abdul Malik',

  // Sindh
  'Karachi', 'Hyderabad', 'Sukkur', 'Larkana', 'Nawabshah', 'Mirpur Khas',
  'Jacobabad', 'Shikarpur', 'Khairpur', 'Dadu', 'Tando Allahyar',
  'Tando Adam', 'Tando Muhammad Khan', 'Thatta', 'Badin', 'Sanghar',
  'Ghotki', 'Kandhkot', 'Kashmore', 'Umerkot', 'Mithi', 'Jamshoro', 'Kotri',
  'Matiari', 'Hala', 'Naushahro Feroze', 'Moro', 'Mehar', 'Sehwan',
  'Kambar', 'Shahdadkot', 'Ratodero', 'Rohri', 'Pano Aqil', 'Daharki',
  'Mirpur Mathelo', 'Gambat', 'Shahdadpur', 'Digri', 'Kunri', 'Jhol',
  'Sujawal', 'Gharo', 'Keti Bandar', 'Golarchi', 'Islamkot', 'Chachro',
  'Diplo', 'Nagarparkar', 'Sakrand', 'Daur', 'Kandiaro', 'Thul', 'Garhi Khairo',
  'Khipro', 'Tando Jam', 'Bhit Shah', 'Johi',

  // Khyber Pakhtunkhwa
  'Peshawar', 'Mardan', 'Abbottabad', 'Mingora', 'Swat', 'Kohat', 'Dera Ismail Khan',
  'Bannu', 'Swabi', 'Charsadda', 'Nowshera', 'Mansehra', 'Haripur',
  'Chitral', 'Dir', 'Timergara', 'Batkhela', 'Malakand', 'Karak', 'Lakki Marwat',
  'Tank', 'Hangu', 'Kohistan', 'Battagram', 'Shangla', 'Alpuri', 'Buner',
  'Daggar', 'Takht-i-Bahi', 'Shabqadar', 'Tangi', 'Topi', 'Risalpur',
  'Pabbi', 'Jehangira', 'Akora Khattak', 'Havelian', 'Nathia Gali',
  'Balakot', 'Oghi', 'Kalam', 'Saidu Sharif', 'Matta', 'Khwazakhela',
  'Chakdara', 'Thana', 'Dargai', 'Wari', 'Upper Dir', 'Lower Dir',
  'Booni', 'Drosh', 'Parachinar', 'Sadda', 'Landi Kotal', 'Jamrud',
  'Bara', 'Khar', 'Miranshah', 'Mir Ali', 'Wana', 'Ghallanai', 'Kalaya',
  'Darra Adam Khel', 'Paharpur', 'Kulachi', 'Daraban', 'Sarai Naurang',
  'Pezu', 'Domel', 'Takht Nasrati', 'Banda Daud Shah',
  'Lachi', 'Kurram', 'Bajaur', 'Mohmand', 'Khyber', 'Orakzai',

  // Balochistan
  'Quetta', 'Gwadar', 'Turbat', 'Khuzdar', 'Chaman', 'Hub', 'Sibi',
  'Zhob', 'Loralai', 'Dera Murad Jamali', 'Dera Allah Yar', 'Usta Muhammad',
  'Kalat', 'Mastung', 'Nushki', 'Kharan', 'Panjgur', 'Pasni', 'Ormara',
  'Jiwani', 'Lasbela', 'Uthal', 'Bela', 'Dalbandin', 'Taftan', 'Washuk',
  'Awaran', 'Pishin', 'Killa Abdullah', 'Killa Saifullah', 'Muslim Bagh',
  'Ziarat', 'Harnai', 'Kohlu', 'Dera Bugti', 'Sui', 'Barkhan', 'Musakhel',
  'Sherani', 'Jhal Magsi', 'Gandava', 'Bhag', 'Dhadar', 'Mach', 'Surab',
  'Kachhi', 'Sohbatpur', 'Chagai', 'Duki', 'Mand',

  // Azad Jammu & Kashmir
  'Muzaffarabad', 'Mirpur', 'Kotli', 'Bhimber', 'Rawalakot', 'Bagh',
  'Pallandri', 'Hajira', 'Dadyal', 'Athmuqam', 'Hattian Bala', 'Forward Kahuta',
  'Sudhnoti', 'Haveli', 'Neelum', 'Samahni', 'Chakswari',

  // Gilgit-Baltistan
  'Gilgit', 'Skardu', 'Hunza', 'Aliabad', 'Karimabad', 'Sost', 'Chilas',
  'Gahkuch', 'Khaplu', 'Shigar', 'Astore', 'Nagar', 'Dambudas', 'Gupis',
  'Tolti', 'Kharmang', 'Roundu', 'Ghizer', 'Diamer',
];

// De-duplicated (case-insensitive) and alphabetical.
export const PAKISTAN_CITIES = Array.from(
  new Map(CITIES.map(c => [c.toLowerCase(), c])).values()
).sort((a, b) => a.localeCompare(b));
