from flask import Flask, render_template, request
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.sql import text
import os

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
mailbox = {} 

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
    if username not in mailbox:
        mailbox[username] = []
    mailbox[username].append(
        {
            "from" : request.form["from"],
            "ciphertext" : request.form["ciphertext"],
            "encrypted_aes_key": request.form["encrypted_aes_key"],
            "nonce" : request.form["nonce"],
            "timestamp" : request.form["timestamp"]
        }
    )
    return {"ok":True}


@app.route('/collect/<username>', methods=["POST"])
def collect(username):
    messages = mailbox.get(username, [])
    mailbox[username] = []   # clear 'cache'

    return {"messages": messages}



if __name__ == '__main__':
    app.run(port=6000, debug=True)