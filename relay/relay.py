from flask import Flask, render_template, request
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.sql import text
import os, json

db = SQLAlchemy() # database connector Class
app = Flask(__name__) # Flask website Class

basedir = os.path.abspath(os.path.dirname(__file__)) # sets the base directory
db_name = "database.db" # I know, my naming is creative, thank you

app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, db_name)

app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = True

# initialize the app with Flask-SQLAlchemy
db.init_app(app)

# this mailbox is where messages are dropped off
# relay server has to be online
# if relay server crashes or is turned off, all unrecieved messages will be lost
MAILBOX_PATH = os.path.join(basedir, "mailboxes.json")

"""
SYNTAX FOR DATABASE QURIES, ALWAYS TRY AND EXCEPT
try:
        db.session.query(text('1')).from_statement(text('SELECT 1')).all()
        return '<h1>It works.</h1>'
except Exception as e:
        # e holds description of the error
        error_text = "<p>The error:<br>" + str(e) + "</p>"
        hed = '<h1>Something is broken.</h1>'
        return hed + error_text
"""

def add_message_to_mailbox(filepath, toUser, sender, ciphertext, encrypted_key, nonce, timestamp):
    if os.path.exists(filepath):
        with open(filepath, "r") as f:
            mailboxes = json.load(f)
    else:
        mailboxes = {}

    if toUser not in mailboxes:
        mailboxes[toUser] = []
    mailboxes[toUser].append(
        {
        "from" : sender,
        "ciphertext" : ciphertext,
        "encrypted_aes_key": encrypted_key,
        "nonce" : nonce,
        "timestamp" : timestamp
        }
    )

    with open(filepath, "w") as f:
        json.dump(mailboxes, f, indent=4)

    return True

def return_user_messages(filepath, toUser):
    if os.path.exists(filepath):
        with open(filepath, "r") as f:
            mailboxes = json.load(f)
    else:
        mailboxes = {}

    messages = mailboxes.get(toUser, [])
    mailboxes[toUser] = [] # clear 'cache'


    return messages



class UserKeys(db.Model):
    __tablename__ = "UserKeys"
    id = db.Column("ID", db.Integer, primary_key=True)
    username = db.Column("Username", db.String, unique=True, nullable=False)
    public_key = db.Column("PublicKey", db.String, nullable=False)

@app.route("/")
def main():
    return render_template("index.html")

# adds a user and its generated public key to the db
@app.route("/register", methods=["POST"])
def register():
    uname = request.form["username"]
    pubkey = request.form["public_key"]

    existing = UserKeys.query.filter_by(username=uname).first()
    if existing:
        existing.public_key = pubkey
    else:
        db.session.add(UserKeys(username=uname, public_key = pubkey))
    db.session.commit()
    return {"login": True}

@app.route("/login", methods=["POST"])
def login():
    uname = request.form["username"]
    existing = UserKeys.query.filter_by(username=uname).first()

    if existing:
        return {"userExists": True}
    else:
        return {"userExists": False}




# returns the public key of a given username from db
@app.route('/pubkey/<username>')
def user(username):
    match = UserKeys.query.filter_by(username=username).first()
    if match is None:
        return {"public_key": None}
    return {"public_key": match.public_key}




@app.route('/dropoff/<username>', methods=["POST"])
def dropoff(username):
    add_message_to_mailbox(MAILBOX_PATH, 
                            username,
                            request.form["from"],
                            request.form["ciphertext"],
                            request.form["encrypted_aes_key"],
                            request.form["nonce"],
                            request.form["timestamp"]
                        )
    return {"ok": True}


@app.route('/collect/<username>', methods=["POST"])
def collect(username):
    return {"messages": return_user_messages(MAILBOX_PATH, username)}

if __name__ == '__main__':
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 6000)), debug=False)