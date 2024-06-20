const express = require('express')
const app = express()
app.use(express.json())
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const path = require('path')

const PORT = 3000
let database
const initializeDbAndServer = async () => {
  try {
    database = await open({
      filename: path.join(__dirname, 'twitterClone.db'),
      driver: sqlite3.Database,
    })

    app.listen(PORT, () => {
      console.log(`Server running on ${PORT}`)
    })
  } catch (e) {
    console.log(e.message)
    process.exit(1)
  }
}

initializeDbAndServer()

const authenticateToken = (request, response, next) => {
  const authHeader = request.headers['authorization']
  let jwtToken
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'Secret_Token', (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.headers.username = payload.username
        next()
      }
    })
  }
}

// API 1

app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  const hashedPassword = await bcrypt.hash(password, 10)
  const getUserDetailsQuery = `select * from user where username = '${username}'`
  const user = await database.get(getUserDetailsQuery)
  if (user === undefined) {
    if (password.length < 6) {
      response.status(400)
      response.send('Password is too short')
    } else {
      const postUserDetailsQuery = `insert into user(name, username, password, gender) values('${name}', '${username}','${hashedPassword}','${gender}')`
      await database.run(postUserDetailsQuery)
      response.status(200)
      response.send('User created successfully')
    }
  } else {
    response.status(400)
    response.send('User already exists')
  }
})

// API 2

app.post('/login/', async (req, res) => {
  const {username, password} = req.body
  const getUserDetailsQuery = `select * from user where username = '${username}'`
  const user = await database.get(getUserDetailsQuery)
  if (user === undefined) {
    res.status(400)
    res.send('Invalid user')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, user.password)
    if (isPasswordMatched) {
      const payload = {
        username: username,
      }
      const jwtToken = jwt.sign(payload, 'Secret_Token')
      res.send({jwtToken})
    } else {
      res.status(400)
      res.send('Invalid password')
    }
  }
})

// API 3
app.get('/user/tweets/feed/', authenticateToken, async (req, res) => {
  const {username} = req.headers
  const getUserQuery = `select * from user where username = '${username}';`
  const dbUser = await database.get(getUserQuery)
  const userId = dbUser['user_id']

  const getLastestTweetsQuery = `select username, tweet, date_time as dateTime from follower inner join tweet on follower.following_user_id = tweet.user_id natural join user where follower.follower_user_id = ${userId} order by dateTime desc limit 4`
  const dbResponse = await database.all(getLastestTweetsQuery)
  res.status(200)
  res.send(dbResponse)
})

// API 4
app.get('/user/following/', authenticateToken, async (req, res) => {
  const {username} = req.headers
  const getUserQuery = `select * from user where username = '${username}';`
  const dbUser = await database.get(getUserQuery)
  const userId = dbUser['user_id']

  const getNames = `select name from follower inner join user on follower.following_user_id = user.user_id where follower.follower_user_id = ${userId}`
  const dbResponse = await database.all(getNames)
  res.status(200)
  res.send(dbResponse)
})

// API 5
app.get('/user/followers/', authenticateToken, async (req, res) => {
  const {username} = req.headers
  const getUserQuery = `select * from user where username = '${username}';`
  const dbUser = await database.get(getUserQuery)
  const userId = dbUser['user_id']

  const getNames = `select name from follower inner join user on follower.follower_user_id = user.user_id where follower.following_user_id = ${userId}`
  const dbResponse = await database.all(getNames)
  res.status(200)
  res.send(dbResponse)
})

const isUserFollowing = async (req, res, next) => {
  const {tweetId} = req.params
  const {username} = req.headers
  const getUserQuery = `select * from user where username = '${username}';`
  const dbUser = await database.get(getUserQuery)
  const userId = dbUser['user_id']

  const followingUserQuery = `select follower_user_id from follower where following_user_id= ${userId}`
  const followingUsers = await database.all(followingUserQuery)
  // console.log(followingUsers)

  const tweetedUserIDQuery = `select * from tweet where tweet_id = ${tweetId}`
  const dbTweetedUser = await database.get(tweetedUserIDQuery)
  const userIdTweeted = dbTweetedUser['user_id']
  // console.log(userIdTweeted)
  let isUserTweetedInFollowingUsers = false

  followingUsers.forEach(eachFollowing => {
    if (eachFollowing['follower_user_id'] === userIdTweeted) {
      isUserTweetedInFollowingUsers = true
    }
  })

  if (isUserTweetedInFollowingUsers) {
    next()
  } else {
    res.status(401)
    res.send('Invalid Request')
  }
}
// API 6
app.get(
  '/tweets/:tweetId/',
  authenticateToken,
  isUserFollowing,
  async (request, response) => {
    const {tweetId} = request.params
    const query = `
        SELECT tweet, COUNT() AS replies, date_time AS dateTime 
        FROM tweet INNER JOIN reply
        ON tweet.tweet_id = reply.tweet_id   
        WHERE tweet.tweet_id = ${tweetId};`
    const data = await database.get(query)

    const likesQuery = `
        SELECT COUNT() AS likes
        FROM like WHERE tweet_id  = ${tweetId};`
    const {likes} = await database.get(likesQuery)

    data.likes = likes
    response.send(data)
  },
)

// API 7
app.get(
  '/tweets/:tweetId/likes/',
  authenticateToken,
  isUserFollowing,
  async (req, res) => {
    const {tweetId} = req.params
    const getUsernameLikedQuery = `select username from user inner join like on user.user_id=like.user_id where like.tweet_id=${tweetId}`
    const usernamesList = await database.all(getUsernameLikedQuery)
    res.send({
      likes: usernamesList.map(eachObj => eachObj.username),
    })
  },
)

// API 8
app.get(
  '/tweets/:tweetId/replies/',
  authenticateToken,
  isUserFollowing,
  async (req, res) => {
    const {tweetId} = req.params
    const getRepliesQuery = `select name, reply from user inner join reply on user.user_id=reply.user_id where reply.tweet_id=${tweetId}`
    const repliesList = await database.all(getRepliesQuery)
    // console.log(repliesList)
    res.send({
      replies: repliesList,
    })
  },
)

// API 9

app.get('/user/tweets/', authenticateToken, async (request, response) => {
  const {username} = request.headers
  const getUserQuery = `
    SELECT * FROM user WHERE username = '${username}';`
  const dbUser = await database.get(getUserQuery)
  const userId = dbUser['user_id']

  const query = `
    SELECT tweet, COUNT() AS likes, date_time As dateTime
    FROM tweet INNER JOIN like
    ON tweet.tweet_id = like.tweet_id
    WHERE tweet.user_id = ${userId}
    GROUP BY tweet.tweet_id;`
  let likesData = await database.all(query)

  const repliesQuery = `
    SELECT tweet, COUNT() AS replies
    FROM tweet INNER JOIN reply
    ON tweet.tweet_id = reply.tweet_id
    WHERE tweet.user_id = ${userId}
    GROUP BY tweet.tweet_id;`

  const repliesData = await database.all(repliesQuery)

  likesData.forEach(each => {
    for (let data of repliesData) {
      if (each.tweet === data.tweet) {
        each.replies = data.replies
        break
      }
    }
  })
  response.send(likesData)
})

// API 10

app.post('/user/tweets/', authenticateToken, async (request, response) => {
  const {tweet} = request.body
  const {username} = request.headers
  const getUserQuery = `
    SELECT * FROM user WHERE username = '${username}';`
  const dbUser = await database.get(getUserQuery)
  const userId = dbUser['user_id']

  const query = `
    INSERT INTO 
        tweet(tweet, user_id)
    VALUES ('${tweet}', ${userId});`
  await database.run(query)
  response.send('Created a Tweet')
})

// API 11

app.delete('/tweets/:tweetId/', authenticateToken, async (req, res) => {
  const {tweetId} = req.params
  const {username} = req.headers

  const getUserQuery = `
    SELECT * FROM user WHERE username = '${username}';`
  const dbUser = await database.get(getUserQuery)
  const userId = dbUser['user_id']

  const userTweetsQuery = `select tweet_id, user_id from tweet where user_id = ${userId}`
  const userTweetsData = await database.all(userTweetsQuery)

  let isTweetOfUser = false

  userTweetsData.forEach(eachTweet => {
    if (eachTweet['tweet_id'] == tweetId) {
      isTweetOfUser = true
    }
  })

  if (isTweetOfUser) {
    const deleteTweetQuery = `delete from tweet where tweet_id = ${tweetId}`
    await database.run(deleteTweetQuery)
    res.send('Tweet Removed')
  } else {
    res.status(401)
    res.send('Invalid Request')
  }
})

module.exports = app
