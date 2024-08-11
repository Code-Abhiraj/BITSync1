const mongoose = require('mongoose');
const {Schema, model} = mongoose;

const UserSchema = new Schema({
  username: {type: String,unique:true},
  email: {type: String,unique:true},
  password: {type: String, required: true},
  role: { type: String, required: true },
});

const UserModel = model('User', UserSchema);

module.exports = UserModel;