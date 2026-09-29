// IELTS MARATHON — Speaking Room topic bank.
// To add a topic: copy any block below into the right list and change the text.
// Part 1 / Part 3: `questions` are read aloud by the examiner one at a time.
// Part 2: `cue` is the card the candidate sees; `rounding` are the short
// follow-up questions the examiner asks after the 2-minute talk.
// Every topic needs a unique `id`.

const SPEAKING_TOPICS = {
  part1: [
    { id: 'p1-hometown', title: 'Hometown', questions: [
      'Where is your hometown?',
      'What do you like most about your hometown?',
      'Has your hometown changed much since you were a child?',
      'Is it a good place for young people to live? Why?',
      'Would you like to live there in the future?'
    ]},
    { id: 'p1-study-work', title: 'Work or studies', questions: [
      'Do you work or are you a student?',
      'Why did you choose that job or subject?',
      'What do you find most interesting about it?',
      'Is there anything you find difficult?',
      'What would you like to do after you finish?'
    ]},
    { id: 'p1-home', title: 'Home and accommodation', questions: [
      'Do you live in a house or an apartment?',
      'Which room do you spend most time in?',
      'What do you like about the place where you live?',
      'Is there anything you would change about your home?',
      'Who do you live with?'
    ]},
    { id: 'p1-routine', title: 'Daily routine', questions: [
      'What does a typical day look like for you?',
      'Are you a morning person or a night person?',
      'Has your routine changed in the last few years?',
      'What is your favourite part of the day?',
      'Do you prefer to plan your day or do things spontaneously?'
    ]},
    { id: 'p1-food', title: 'Food and cooking', questions: [
      'What kind of food do you enjoy most?',
      'Do you like cooking? Why or why not?',
      'Is there a dish from your country that visitors should try?',
      'Do you usually eat at home or eat out?',
      'Has your diet changed compared with when you were younger?'
    ]},
    { id: 'p1-family', title: 'Family', questions: [
      'Tell me a little about your family.',
      'Who are you closest to in your family?',
      'Do you spend a lot of time with your relatives?',
      'What activities do you enjoy doing together?',
      'Do you think family is more important than friends?'
    ]},
    { id: 'p1-friends', title: 'Friends', questions: [
      'Do you have many friends or a few close ones?',
      'How did you meet your best friend?',
      'How often do you see your friends?',
      'What makes someone a good friend?',
      'Do you keep in touch with friends from school?'
    ]},
    { id: 'p1-free-time', title: 'Free time and hobbies', questions: [
      'What do you like to do in your free time?',
      'Have your hobbies changed since you were a child?',
      'Do you prefer indoor or outdoor activities?',
      'Is there a hobby you would like to try in the future?',
      'Do you prefer spending free time alone or with others?'
    ]},
    { id: 'p1-weather', title: 'Weather and seasons', questions: [
      'What is the weather like in your city?',
      'Which season do you like best? Why?',
      'Does the weather affect your mood?',
      'What do you usually do on a rainy day?',
      'Would you prefer to live somewhere hotter or colder?'
    ]},
    { id: 'p1-technology', title: 'Technology', questions: [
      'What technology do you use every day?',
      'Do you think you spend too much time on your phone?',
      'How do you usually keep in touch with people?',
      'Which piece of technology could you not live without?',
      'Have you ever had trouble learning to use a new device?'
    ]},
    { id: 'p1-music', title: 'Music', questions: [
      'What kind of music do you enjoy?',
      'When do you usually listen to music?',
      'Did you learn a musical instrument as a child?',
      'Do you prefer live concerts or recorded music?',
      'Has your taste in music changed over time?'
    ]},
    { id: 'p1-travel', title: 'Travel', questions: [
      'Do you enjoy travelling?',
      'What was the last place you visited?',
      'Do you prefer travelling alone or with other people?',
      'Is there a place you have always wanted to visit?',
      'What do you usually bring back from a trip?'
    ]},
    { id: 'p1-shopping', title: 'Shopping', questions: [
      'Do you enjoy going shopping?',
      'Do you prefer shopping online or in stores?',
      'What was the last thing you bought that you were really happy with?',
      'Do you usually plan what to buy or shop on impulse?',
      'Are there any markets or shops in your area that are popular?'
    ]},
    { id: 'p1-reading', title: 'Reading', questions: [
      'Do you like reading?',
      'What kinds of things do you read most often?',
      'Did you read a lot when you were a child?',
      'Do you prefer paper books or reading on a screen?',
      'Is there a book you would recommend to a friend?'
    ]},
    { id: 'p1-sport', title: 'Sport and exercise', questions: [
      'Do you play any sports?',
      'What sports are popular in your country?',
      'Do you prefer to exercise alone or in a group?',
      'Did you do much sport at school?',
      'How do you keep fit and healthy?'
    ]}
  ],

  part2: [
    { id: 'p2-teacher', title: 'A teacher who influenced you',
      cue: { prompt: 'Describe a teacher who has influenced you.', points: ['who the teacher was', 'what subject they taught', 'what they did that was special'], ending: 'and explain why this teacher was important to you.' },
      rounding: ['Do you still keep in touch with this teacher?', 'Would you like to become a teacher yourself?'] },
    { id: 'p2-place', title: 'A place you would recommend',
      cue: { prompt: 'Describe a place you have visited that you would recommend to others.', points: ['where it is', 'when you went there', 'what you did there'], ending: 'and explain why you would recommend it.' },
      rounding: ['Would you like to go back?', 'Who did you go with?'] },
    { id: 'p2-tech', title: 'A useful piece of technology',
      cue: { prompt: 'Describe a piece of technology you own that is very useful to you.', points: ['what it is', 'how long you have had it', 'what you use it for'], ending: 'and explain why it is so useful.' },
      rounding: ['Would you buy a newer version?', 'Do you take good care of it?'] },
    { id: 'p2-helped', title: 'A time you helped someone',
      cue: { prompt: 'Describe a time when you helped another person.', points: ['who you helped', 'what the problem was', 'how you helped them'], ending: 'and explain how you felt afterwards.' },
      rounding: ['Did they thank you?', 'Has anyone helped you in a similar way?'] },
    { id: 'p2-film', title: 'A book or film you enjoyed',
      cue: { prompt: 'Describe a book or film that you enjoyed.', points: ['what it was about', 'when you read or watched it', 'who recommended it'], ending: 'and explain why you enjoyed it so much.' },
      rounding: ['Would you watch or read it again?', 'Have you recommended it to anyone?'] },
    { id: 'p2-skill', title: 'A skill you learned recently',
      cue: { prompt: 'Describe a skill you have learned recently.', points: ['what the skill is', 'how you learned it', 'what was difficult about it'], ending: 'and explain how you plan to use this skill in the future.' },
      rounding: ['Was it easy to find time to practise?', 'Would you teach it to someone else?'] },
    { id: 'p2-meal', title: 'A memorable meal',
      cue: { prompt: 'Describe a meal you remember well.', points: ['where you had it', 'who you ate with', 'what you ate'], ending: 'and explain why it was memorable.' },
      rounding: ['Do you often eat with the same people?', 'Have you tried to cook that meal yourself?'] },
    { id: 'p2-busy-place', title: 'A busy place',
      cue: { prompt: 'Describe a busy place you have been to.', points: ['where it was', 'why you went there', 'what it was like'], ending: 'and explain how you felt about being there.' },
      rounding: ['Do you enjoy crowded places?', 'Would you go there again?'] },
    { id: 'p2-funny-person', title: 'A person who makes you laugh',
      cue: { prompt: 'Describe a person you know who is very funny.', points: ['who this person is', 'how you know them', 'what kind of things they say or do'], ending: 'and explain why you enjoy spending time with them.' },
      rounding: ['Are you a funny person yourself?', 'Do you often laugh together?'] },
    { id: 'p2-event', title: 'A public event',
      cue: { prompt: 'Describe a public event you attended.', points: ['what the event was', 'who you went with', 'what happened there'], ending: 'and explain whether you enjoyed it.' },
      rounding: ['Would you go to a similar event again?', 'Do you prefer big or small events?'] },
    { id: 'p2-goal', title: 'A goal you want to achieve',
      cue: { prompt: 'Describe something you would like to achieve in the future.', points: ['what it is', 'when you hope to achieve it', 'what you need to do to achieve it'], ending: 'and explain why it is important to you.' },
      rounding: ['Have you told anyone about this goal?', 'What could stop you?'] },
    { id: 'p2-waiting', title: 'A time you had to wait',
      cue: { prompt: 'Describe a time when you had to wait for something.', points: ['what you were waiting for', 'where you were', 'how long you waited'], ending: 'and explain how you felt while you were waiting.' },
      rounding: ['Are you a patient person?', 'What do you usually do when you wait?'] }
  ],

  part3: [
    { id: 'p3-education', title: 'Education and teachers', questions: [
      'What makes a good teacher, in your opinion?',
      'How has education changed compared with your parents’ generation?',
      'Should students learn practical skills at school as well as academic subjects?',
      'Do you think online learning can replace classrooms?',
      'Who has more influence on a child: teachers or parents?'
    ]},
    { id: 'p3-technology', title: 'Technology and communication', questions: [
      'How has technology changed the way people communicate?',
      'Do you think people rely on technology too much?',
      'What are the advantages and disadvantages of social media?',
      'Will face-to-face conversation become less common in the future?',
      'Should children have limits on how much time they spend on screens?'
    ]},
    { id: 'p3-travel', title: 'Travel and tourism', questions: [
      'Why do so many people like to travel abroad?',
      'What are the benefits of tourism for a country?',
      'Can tourism cause problems for local people? How?',
      'Is it better to travel independently or with a tour group?',
      'How might travel change in the next twenty years?'
    ]},
    { id: 'p3-helping', title: 'Helping others and community', questions: [
      'Why do some people volunteer their time to help others?',
      'Do you think people help each other less than they did in the past?',
      'What can governments do to encourage community spirit?',
      'Is it the government’s job or individuals’ to help people in need?',
      'How can young people contribute to their communities?'
    ]},
    { id: 'p3-media', title: 'Media and entertainment', questions: [
      'Why are films and TV series so popular around the world?',
      'Do you think entertainment can also be educational?',
      'How has the way people watch films and TV changed?',
      'Should there be limits on what children are allowed to watch?',
      'Do celebrities have too much influence on young people?'
    ]},
    { id: 'p3-skills', title: 'Learning new skills', questions: [
      'What is the best way for adults to learn a new skill?',
      'Are some skills easier to learn when you are young?',
      'Is it better to learn from a teacher or teach yourself?',
      'Which skills will be most important for people in the future?',
      'Why do some people give up when learning something new?'
    ]},
    { id: 'p3-food-health', title: 'Food and health', questions: [
      'Why do many people find it difficult to eat healthily?',
      'Has the food people eat in your country changed in recent years?',
      'Should governments control the advertising of unhealthy food?',
      'Do you think traditional food will disappear in the future?',
      'How important is it to teach children about nutrition?'
    ]},
    { id: 'p3-city', title: 'City life and crowds', questions: [
      'What are the advantages and disadvantages of living in a big city?',
      'Why are so many people moving from villages to cities?',
      'How can cities be made more pleasant to live in?',
      'Do you think public transport should be free?',
      'What problems can overcrowding cause?'
    ]},
    { id: 'p3-work', title: 'Work and careers', questions: [
      'What is more important in a job: salary or job satisfaction?',
      'Do you think people change careers more often now than in the past?',
      'How might technology change the types of jobs available?',
      'Is it better to work for a large company or a small one?',
      'What can employers do to keep their workers happy?'
    ]},
    { id: 'p3-celebrations', title: 'Celebrations and traditions', questions: [
      'Why are traditional celebrations important to a society?',
      'Are festivals in your country celebrated in the same way as in the past?',
      'Do you think celebrations have become too commercial?',
      'How can traditions be passed on to younger generations?',
      'Can international festivals help people understand other cultures?'
    ]},
    { id: 'p3-environment', title: 'The environment', questions: [
      'What are the biggest environmental problems in your country?',
      'Is it more effective for individuals or governments to protect the environment?',
      'Should companies be punished for polluting?',
      'How can schools teach children to care about nature?',
      'Do you think people will do enough to protect the planet?'
    ]},
    { id: 'p3-time', title: 'Time and punctuality', questions: [
      'Why do some people always arrive late?',
      'Is being on time more important in some cultures than others?',
      'Do people today have less free time than in the past?',
      'How can people manage their time better?',
      'Is it ever acceptable to keep other people waiting?'
    ]}
  ]
};

// Deterministic "suggested for today" picks: the same day gives the same
// suggestions to everyone, and each new day rotates through the bank.
function speakingSuggestions(day) {
  const d = Math.max(1, day || 1);
  const pick = (arr, n, salt) => Array.from({ length: n }, (_, i) => arr[(d * n + i + salt) % arr.length]);
  return {
    part1: pick(SPEAKING_TOPICS.part1, 2, 0),
    part2: pick(SPEAKING_TOPICS.part2, 1, 0),
    part3: pick(SPEAKING_TOPICS.part3, 1, 0)
  };
}
