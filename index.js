//Public API list: https://github.com/appbrewery/public-api-lists/tree/master
// Alpha Vantage API documentation: https://www.alphavantage.co/documentation/

import express from "express";
import { dirname } from "path";
import { fileURLToPath } from "url";
import bodyParser from "body-parser";
import { promises as fs } from "fs"; //to read file
import axios from "axios";

import pg from "pg"; //to use postgress db
import env from "dotenv"; //to use env
import bcrypt from "bcrypt"; //to hash password

import passport from "passport"; //For login sesstion
import { Strategy } from "passport-local"; //For login sesstion
import session from "express-session"; //For login sesstion
import GoogleStrategy from "passport-google-oauth2"; // For Google login authentication

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = 3000;
const saltRounds = 10; //to set number of salt for hash

env.config();

async function readFile() {
  try {
    const data = await fs.readFile("secret/alphaAPI.txt", "utf8");
    return data.trim(); // Remove any extraneous whitespace/newline
  } catch (err) {
    console.error(err);
    throw err; // Re-throw the error after logging it
  }
}

app.use(express.static("public")); // connect to static files such as CSS under "public".

app.use(bodyParser.urlencoded({ extended: true }));

const db = new pg.Client({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
});
db.connect();

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
  })
);
app.use(passport.initialize());
app.use(passport.session());

app.get("/", async (req, res) => {
  try {
    res.render("index.ejs", { sample: "Please select ticker" });
  } catch (err) {
    res.status(500).send("Internal Server Error");
  }
});

app.get("/login", async (req, res) => {
  try {
    res.render("login.ejs");
  } catch (err) {
    res.status(500).send("Internal Server Error");
  }
});

app.get("/register", (req, res) => {
  res.render("register.ejs");
});

app.get("/secrets", async (req, res) => {
  console.log(`User: ${req.user.id}`);
  if (req.isAuthenticated()) {
    try {
      //   const secretResult = await db.query(
      //     "SELECT secret FROM users WHERE id = $1",
      //     [req.user.id]
      //   );
      //   const userSecret = secretResult.rows[0]?.secret || "";
      //   res.render("secrets.ejs", { secret: userSecret });
      res.render("secrets.ejs");
    } catch (err) {
      console.log(err);
    }
  } else {
    res.redirect("/login");
  }
});

app.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
  })
);

app.get(
  "/auth/google/secrets",
  passport.authenticate("google", {
    successRedirect: "/secrets",
    failureRedirect: "/login",
  })
);

app.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      console.log(err);
    } else {
      res.redirect("/");
    }
  });
});

//get data for selected ticker
app.post("/ticker", async (req, res) => {
  const ticker = req.body.ticker; //correct ticker posted from client

  try {
    const apiKey = await readFile(); //Await the promise to get the API key
    const url = `https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=${ticker}&interval=5min&apikey=${apiKey}`;

    //console.log(apiKey);
    console.log(url);

    const result = await axios.get(url);
    const data = result.data;
    const prettyResult = JSON.stringify(result.data, null, 2);
    console.log(prettyResult);

    res.render("index.ejs", { content: data });
  } catch (err) {
    res.status(500).send("Internal Server Error");
  }
});

app.post("/register", async (req, res) => {
  const email = req.body.username;
  const password = req.body.password;

  try {
    const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);

    if (checkResult.rows.length > 0) {
      res.redirect("/login");
    } else {
      bcrypt.hash(password, saltRounds, async (err, hash) => {
        if (err) {
          console.error("Error hashing password:", err);
        } else {
          const result = await db.query(
            "INSERT INTO users (email, password) VALUES ($1, $2) RETURNING *",
            [email, hash]
          );
          const user = result.rows[0];
          req.login(user, (err) => {
            console.log("success");
            res.redirect("/secrets");
          });
        }
      });
    }
  } catch (err) {
    console.log(err);
  }
});

app.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/secrets",
    failureRedirect: "/login",
  })
);

///Strategy of passport
passport.use(
  "local",
  new Strategy(async function verify(username, password, cb) {
    try {
      const result = await db.query("SELECT * FROM users WHERE email = $1 ", [
        username,
      ]);
      if (result.rows.length > 0) {
        const user = result.rows[0];
        const storedHashedPassword = user.password;
        bcrypt.compare(password, storedHashedPassword, (err, valid) => {
          if (err) {
            //Error with password check
            console.error("Error comparing passwords:", err);
            return cb(err);
          } else {
            if (valid) {
              //Passed password check
              return cb(null, user);
            } else {
              //Did not pass password check
              return cb(null, false);
            }
          }
        });
      } else {
        return cb("User not found");
      }
    } catch (err) {
      console.log(err);
      return cb(err);
    }
  })
);

passport.use(
  "google",
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID, //set up in Google cloud
      clientSecret: process.env.GOOGLE_CLIENT_SECRET, //set up in Google cloud
      callbackURL: "http://localhost:3000/auth/google/secrets",
      userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo",
    },
    async (accessToken, refreshToken, profile, cb) => {
      console.log(profile);
      try {
        //check if use exist in db
        const result = await db.query("SELECT * FROM users WHERE email = $1", [
          profile.email,
        ]);
        if (result.rows.length === 0) {
          //if user doesn't exist in db
          const newUser = await db.query(
            "INSERT INTO users (email, password) VALUES ($1, $2)",
            [profile.email, "goggle"]
          );
          return cb(null, newUser.rows[0]);
        } else {
          //if user exist in db
          return cb(null, result.rows[0]);
        }
      } catch (err) {
        return cb(err);
      }
    }
  )
);
//-----------------------------------------------

//Serialize passport
passport.serializeUser((user, cb) => {
  cb(null, user);
});
passport.deserializeUser((user, cb) => {
  cb(null, user);
});
//----------------------------------------------

app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});

//TODO setup Google Oauth
