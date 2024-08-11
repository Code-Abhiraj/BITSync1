const express = require('express');
const cors = require('cors');
const { sendEmail } = require('./emailService');
const app = express();
const mongoose = require('mongoose');
const User = require('./models/User');
const Post = require('./models/Post'); 
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const uploadMiddleware = multer({ dest: 'uploads/' });
const cookieParser = require('cookie-parser');
const fs = require('fs');
const salt = bcrypt.genSaltSync(10);
const secret = 'asjjdajfbwf7wy98y8f79';
const { htmlToText } = require('html-to-text');
const { z } = require('zod');
require("dotenv").config;
app.use(cors({ credentials: true, origin: 'http://localhost:3000' }));
app.use(express.json());
app.use(cookieParser());
app.use('/uploads', express.static(__dirname + '/uploads'));


mongoose.connect('mongodb+srv://abhirajkr6200:ObwAWbKXMNicUAbM@cluster0.zzunv3h.mongodb.net/');

const registerSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters long"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters long"),
  role: z.enum(["student", "administrative"])
});

app.post('/register', async (req, res) => {
  try {
    const { username, email, password, role } = registerSchema.parse(req.body);

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ message: 'Username already exists' });
    }

    const userDoc = await User.create({
      username,
      email,
      password: bcrypt.hashSync(password, salt),
      role,
    });
    res.json(userDoc);
  } catch (e) {
    console.log(e);
    if (e instanceof z.ZodError) {
      return res.status(400).json(e.errors);
    }
    res.status(400).json(e);
  }
});


const loginSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters long"),
  password: z.string().min(6, "Password must be at least 6 characters long"),
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = loginSchema.parse(req.body);

    const userDoc = await User.findOne({ username });
    if (!userDoc) {
      return res.status(400).json({ message: 'Username does not exist' });
    }

    const passOk = bcrypt.compareSync(password, userDoc.password);
    if (!passOk) {
      return res.status(400).json({ message: 'Incorrect password' });
    }

    jwt.sign({ username, id: userDoc._id, role: userDoc.role }, secret, {}, (err, token) => {
      if (err) throw err;
      res.cookie('token', token).json({
        id: userDoc._id,
        username,
      });
    });
  } catch (e) {
    console.log(e);
    if (e instanceof z.ZodError) {
      return res.status(400).json(e.errors);
    }
    res.status(400).json(e);
  }
});

app.post('/logout', (req, res) => {
  res.cookie('token', '').json('ok');
});

app.get('/profile', (req, res) => {
  const { token } = req.cookies;
  jwt.verify(token, secret, {}, (err, info) => {
    if (err) throw err;
    res.json(info);
  });
});


app.post('/post', uploadMiddleware.single('file'), async (req, res) => {
  const { originalname, path } = req.file;
  const parts = originalname.split('.');
  const ext = parts[parts.length - 1];
  const newPath = path + '.' + ext;
  fs.renameSync(path, newPath);

  const { token } = req.cookies;
  jwt.verify(token, secret, {}, async (err, info) => {
    if (err) throw err;
    const { title, summary, content, studentsOnly } = req.body;

    const postDoc = await Post.create({
      title,
      summary,
      content,
      cover: newPath,
      author: info.id,
      studentsOnly
    });

    // Fetch all users
    const users = await User.find({}, 'email role');

    let userEmails = [];
    if (studentsOnly === 'true') {
      userEmails = users
        .filter(user => user.role === 'student')
        .map(user => user.email);
    } else {
      userEmails = users.map(user => user.email);
    }

    const plainTextContent = htmlToText(content, {
      wordwrap: 130,
      preserveNewlines: true
    });

    // Construct the URL for the post
    const postUrl = `http://localhost:3000/post/${postDoc._id}`;

    const subject = `New Post: ${title}`;
    const text = `A new post has been created:\n\nTitle: ${title}\nSummary: ${summary}\nContent:\n${plainTextContent}\n\nGo to Post: ${postUrl}`;

    userEmails.forEach(email => {
      sendEmail(email, subject, text);
    });

    res.json(postDoc);
  });
});


app.put('/post',uploadMiddleware.single('file'), async (req,res) => {
  let newPath = null;
  if (req.file) {
    const {originalname,path} = req.file;
    const parts = originalname.split('.');
    const ext = parts[parts.length - 1];
    newPath = path+'.'+ext;
    fs.renameSync(path, newPath);
  }

  const {token} = req.cookies;
  jwt.verify(token, secret, {}, async (err,info) => {
    if (err) throw err;
    const {id,title,summary,content} = req.body;
    const postDoc = await Post.findById(id);
    const isAuthor = JSON.stringify(postDoc.author) === JSON.stringify(info.id);
    if (!isAuthor) {
      return res.status(400).json('you are not the author');
    }
    await postDoc.updateOne({
      title,
      summary,
      content,
      cover: newPath ? newPath : postDoc.cover,
    });

    res.json(postDoc);
  });

});


app.get('/post', async (req, res) => {
  const { token } = req.cookies;

  if (!token) {
    return res.status(401).json({ error: 'Token must be provided' });
  }

  jwt.verify(token, secret, {}, async (err, info) => {
    if (err) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // If the user is administrative staff, filter out studentsOnly posts
    let filter = {};
    if (info.role !== 'student') {
      filter = { studentsOnly: false };
    }

    const posts = await Post.find(filter)
      .populate('author', ['username'])
      .sort({ createdAt: -1 })
      .limit(20);

    res.json(posts);
  });
});


app.get('/post/:id', async (req, res) => {
  const {id} = req.params;
  const postDoc = await Post.findById(id).populate('author', ['username']);
  res.json(postDoc);
})
app.delete('/post/:id', async (req, res) => {
  const { token } = req.cookies;
  jwt.verify(token, secret, {}, async (err, info) => {
    if (err) throw err;
    const { id } = req.params;
    const postDoc = await Post.findById(id);
    if (!postDoc) {
      return res.status(404).json('Post not found');
    }
    const isAuthor = JSON.stringify(postDoc.author) === JSON.stringify(info.id);
    if (!isAuthor) {
      return res.status(400).json('You are not the author');
    }
    await postDoc.deleteOne();
    res.json({ message: 'Post deleted successfully' });
  });
});
app.listen(4000, () => {
  console.log('Server running on port 4000');
});
//Xog2OxRlrkWEZ7V0
//mongodb+srv://Blogify:<password>@cluster0.soleyfq.mongodb.net/
//KTbp2YWV4dSPbPvA
//mongodb+srv://abhirajkr6200:KTbp2YWV4dSPbPvA@cluster0.wusx4tp.mongodb.net/
//BZAODpeKEgzTdAeF
//mongodb+srv://abhirajkr6200:BZAODpeKEgzTdAeF@cluster0.dt6mc8d.mongodb.net/
//ObwAWbKXMNicUAbM
//mongodb+srv://abhirajkr6200:ObwAWbKXMNicUAbM@cluster0.zzunv3h.mongodb.net/