"""
NoBackdoorMessaging.
"""
from flask import Flask, render_template, request
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.sql import text
from cryptography.hazmat.primitives.asymmetric import rsa


db = SQLAlchemy() # database connector Class
app = Flask(__name__) # Flask website Class

db_name = "database.db" # I know, my naming is creative, thank you

app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + db_name

app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = True

# initialize the app with Flask-SQLAlchemy
db.init_app(app)

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

# Class to add records to the database
class UserKeys(db.Model):
    __tablename__ = "UserKeys"
    id = db.Column("ID", db.Integer, primary_key=True)
    username = db.Column("Username", db.String, unique=True, nullable=False)
    public_key = db.Column("PublicKey", db.String, nullable=False)

    


@app.route('/')
def main():
    return render_template("setup.html")

@app.route("/register", methods=["POST"])
def register():
    username = request.form["username"]
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048)
    public_key = private_key.public_key()

    

    
    return render_template("setup.html")


if __name__ == "__main__":
    app.run(debug=True)
