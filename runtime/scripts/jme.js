/*
Copyright 2011-14 Newcastle University
   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at
       http://www.apache.org/licenses/LICENSE-2.0
   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/
/** @file Sets up the JME compiler and evaluator.
 *
 * Provides {@link Numbas.jme}
 */
Numbas.queueScript('jme',['jme-base','jme-builtins','jme-rules'],function(){
    var jme = Numbas.jme;
    /** For backwards compatibility, copy references to some members of jme.rules to jme.
     * These items used to belong to Numbas.jme, but were spun out to Numbas.jme.rules.
     */
    ['displayFlags','Ruleset','collectRuleset'].forEach(function(name) {
        jme[name] = jme.rules[name];
    });
});
Numbas.queueScript('jme-base',['base','math','util'],function() {
var util = Numbas.util;
var math = Numbas.math;

/** A JME expression.
 * @typedef JME
 * @type {String}
 * @see {@link http://numbas-editor.readthedocs.io/en/latest/jme-reference.html}
 */

/** @typedef Numbas.jme.tree
  * @type {Object}
  * @property {Array.<Numbas.jme.tree>} args - the token's arguments (if it's an op or function)
  * @property {Numbas.jme.token} tok - the token at this node
  */

/** @namespace Numbas.jme */
var jme = Numbas.jme = /** @lends Numbas.jme */ {
    /** Mathematical constants */
    constants: {
        'e': Math.E,
        'pi': Math.PI,
        'π': Math.PI,
        'i': math.complex(0,1),
        'infinity': Infinity,
        'infty': Infinity,
        'nan': NaN,
        '∞': Infinity
    },
    /** Escape a string so that it will be interpreted correctly by the JME parser
     * @param {String} str
     * @returns {String}
     * @see Numbas.jme.unescape
     */
    escape: function(str) {
        return str
            .replace(/\\/g,'\\\\')
            .replace(/\\([{}])/g,'$1')
            .replace(/\n/g,'\\n')
            .replace(/"/g,'\\"')
            .replace(/'/g,"\\'")
        ;
    },

    /** Wrapper around {@link Numbas.jme.Parser#compile}
     * @param {JME} expr
     * @see Numbas.jme.Parser#compile
     * @returns {Numbas.jme.tree}
     */
    compile: function(expr) {
        var parser = new jme.Parser();
        return parser.compile(expr);
    },

    /** Wrapper around {@link Numbas.jme.Parser#tokenise}
     * @param {JME} expr
     * @see Numbas.jme.Parser#tokenise
     * @returns {Numbas.jme.token[]}
     */
    tokenise: function(expr) {
        var parser = new jme.Parser();
        return parser.tokenise(expr);
    },

    /** Wrapper around {@link Numbas.jme.Parser#shunt}
     * @param {Numbas.jme.token[]} tokens
     * @see Numbas.jme.Parser#shunt
     * @returns {Numbas.jme.tree}
     */
    shunt: function(tokens) {
        var parser = new jme.Parser();
        return parser.shunt(expr);
    },

    /** Unescape a string - backslashes escape special characters
     * @param {String} str
     * @returns {String}
     * @see Numbas.jme.escape
     */
    unescape: function(str) {
        var estr = '';
        while(true) {
            var i = str.indexOf('\\');
            if(i==-1)
                break;
            else {
                estr += str.slice(0,i);
                var c;
                if((c=str.charAt(i+1))=='n') {
                    estr+='\n';
                }
                else if(c=='{' || c=='}') {
                    estr+='\\'+c;
                }
                else {
                    estr+=c;
                }
                str=str.slice(i+2);
            }
        }
        estr+=str;
        return estr;
    },
    /** Substitute variables defined in `scope` into the given syntax tree (in place).
     * @param {Numbas.jme.tree} tree
     * @param {Numbas.jme.Scope} scope
     * @param {Boolean} [allowUnbound=false] - allow unbound variables to remain in the returned tree
     * @returns {Numbas.jme.tree}
     */
    substituteTree: function(tree,scope,allowUnbound)
    {
        if(!tree)
            return null;
        if(tree.tok.bound)
            return tree;
        if(tree.args===undefined)
        {
            if(tree.tok.type=='name')
            {
                var name = tree.tok.name.toLowerCase();
                var v = scope.getVariable(name);
                if(v===undefined)
                {
                    if(allowUnbound)
                        return {tok: new TName(name)};
                    else
                        throw new Numbas.Error('jme.substituteTree.undefined variable',{name:name});
                }
                else
                {
                    if(v.tok) {
                        return v;
                    } else {
                        return {tok: v};
                    }
                }
            }
            else {
                return tree;
            }
        } else if((tree.tok.type=='function' || tree.tok.type=='op') && tree.tok.name in substituteTreeOps) {
            tree = {tok: tree.tok,
                    args: tree.args.slice()};
            substituteTreeOps[tree.tok.name](tree,scope,allowUnbound);
            return tree;
        } else {
            tree = {
                tok: tree.tok,
                args: tree.args.slice()
            };
            for(var i=0;i<tree.args.length;i++) {
                tree.args[i] = jme.substituteTree(tree.args[i],scope,allowUnbound);
            }
            return tree;
        }
    },
    /** Evaluate a syntax tree (or string, which is compiled to a syntax tree), with respect to the given scope.
     * @param {Numbas.jme.tree|String} tree
     * @param {Numbas.jme.Scope} scope
     * @returns {Numbas.jme.token}
     */
    evaluate: function(tree,scope)
    {
        if(!scope) {
            throw(new Numbas.Error('jme.evaluate.no scope given'));
        }
        return scope.evaluate(tree);
    },
    /** Compile a list of expressions, separated by commas
     * @param {JME} expr
     * @see Numbas.jme.tokenise
     * @see Numbas.jme.shunt
     * @returns {Numbas.jme.tree[]}
     */
    compileList: function(expr,scope) {
        expr+='';    //make sure expression is a string and not a number or anything like that
        if(!expr.trim().length)
            return null;
        //typecheck
        scope = new Scope(scope);
        //tokenise expression
        var tokens = jme.tokenise(expr);
        var bits = [];
        var brackets = [];
        var start = 0;
        for(var i=0;i<tokens.length;i++) {
            switch(tokens[i].type) {
                case '(':
                case '[':
                    brackets.push(tokens[i]);
                    break;
                case ')':
                    if(!brackets.length || brackets.pop().type!='(') {
                        throw(new Numbas.Error('jme.compile list.mismatched bracket'));
                    }
                    break;
                case ']':
                    if(!brackets.length || brackets.pop().type!='[') {
                        throw(new Numbas.Error('jme.compile list.mismatched bracket'));
                    }
                    break;
                case ',':
                    if(brackets.length==0) {
                        bits.push(tokens.slice(start,i));
                        start = i+1;
                    }
                    break;
            }
        }
        if(brackets.length) {
            throw(new Numbas.Error('jme.compile list.missing right bracket'));
        }
        bits.push(tokens.slice(start));
        //compile to parse tree
        var trees = bits.map(function(b){return jme.shunt(b)});
        return trees;
    },
    /** Settings for {@link Numbas.jme.compare}
     * @typedef {Object} Numbas.jme.compare_settings
     * @property {String} checkingType - The name of the method to determine if two results are equal. See {@link Numbas.jme.checkingFunctions}.
     * @property {Number} vsetRangeStart - The lower bound of the range to pick variable values from.
     * @property {Number} vsetRangeEnd - The upper bound of the range to pick variable values from.
     * @property {Number} vsetRangePoints - The number of values to pick for each variable.
     * @property {Number} checkingAccuracy - A parameter for the checking function to determine if two results are equal. See {@link Numbas.jme.checkingFunctions}.
     * @property {Number} failureRate - The number of times the comparison must fail to declare that the expressions are unequal.
     */
    /** Compare two expressions over some randomly selected points in the space of variables, to decide if they're equal.
     * @param {JME} expr1
     * @param {JME} expr2
     * @param {Numbas.jme.compare_settings} settings
     * @param {Numbas.jme.Scope} scope
     * @returns {Boolean}
     */
    compare: function(expr1,expr2,settings,scope) {
        expr1 += '';
        expr2 += '';
        var compile = jme.compile, evaluate = jme.evaluate;
        var checkingFunction = checkingFunctions[settings.checkingType.toLowerCase()];    //work out which checking type is being used
        try {
            var tree1 = compile(expr1,scope);
            var tree2 = compile(expr2,scope);
            if(tree1 == null || tree2 == null)
            {    //one or both expressions are invalid, can't compare
                return false;
            }
            //find variable names used in both expressions - can't compare if different
            var vars1 = findvars(tree1);
            var vars2 = findvars(tree2);
            for(var v in scope.allVariables()) {
                delete vars1[v];
                delete vars2[v];
            }
            if( !varnamesAgree(vars1,vars2) )
            {    //whoops, differing variables
                return false;
            }
            if(vars1.length)
            {    // if variables are used,  evaluate both expressions over a random selection of values and compare results
                var errors = 0;
                var rs = randoms(vars1, settings.vsetRangeStart, settings.vsetRangeEnd, settings.vsetRangePoints);
                for(var i = 0; i<rs.length; i++) {
                    var nscope = new jme.Scope([scope,{variables:rs[i]}]);
                    var r1 = evaluate(tree1,nscope);
                    var r2 = evaluate(tree2,nscope);
                    if( !resultsEqual(r1,r2,checkingFunction,settings.checkingAccuracy) ) { errors++; }
                }
                if(errors < settings.failureRate) {
                    return true;
                }else{
                    return false;
                }
            } else {
                //if no variables used, can just evaluate both expressions once and compare
                r1 = evaluate(tree1,scope);
                r2 = evaluate(tree2,scope);
                return resultsEqual(r1,r2,checkingFunction,settings.checkingAccuracy);
            }
        }
        catch(e) {
            return false;
        }
    },
    /** Substitute variables into content. To substitute variables, use {@link Numbas.jme.variables.DOMcontentsubvars}.
     * @param {String} str
     * @param {Numbas.jme.Scope} scope
     * @returns {String}
     */
    contentsubvars: function(str, scope)
    {
        var bits = util.contentsplitbrackets(str);    //split up string by TeX delimiters. eg "let $X$ = \[expr\]" becomes ['let ','$','X','$',' = ','\[','expr','\]','']
        for(var i=0; i<bits.length; i+=4)
        {
            bits[i] = jme.subvars(bits[i],scope,true);
        }
        return bits.join('');
    },
    /** Split up a TeX expression, finding the \var and \simplify commands.
     * Returns an array [normal tex,var or simplify,options,argument,normal tex,...]a
     * @param {String} s
     * @returns {Array.<String>}
     */
    texsplit: function(s)
    {
        var cmdre = /^((?:.|[\n\r])*?)\\(var|simplify)/m;
        var out = [];
        var m;
        while( m = s.match(cmdre) )
        {
            out.push(m[1]);
            var cmd = m[2];
            out.push(cmd);
            var i = m[0].length;
            var args = '';
            var argbrackets = false;
            if( s.charAt(i) == '[' )
            {
                argbrackets = true;
                var si = i+1;
                while(i<s.length && s.charAt(i)!=']')
                    i++;
                if(i==s.length)
                    throw(new Numbas.Error('jme.texsubvars.no right bracket',{op:cmd}));
                else
                {
                    args = s.slice(si,i);
                    i++;
                }
            }
            if(!argbrackets)
                args='all';
            out.push(args);
            if(s.charAt(i)!='{')
            {
                throw(new Numbas.Error('jme.texsubvars.missing parameter',{op:cmd,parameter:s}));
            }
            var brackets=1;
            var si = i+1;
            while(i<s.length-1 && brackets>0)
            {
                i++;
                if(s.charAt(i)=='{')
                    brackets++;
                else if(s.charAt(i)=='}')
                    brackets--;
            }
            if(i == s.length-1 && brackets>0)
                throw(new Numbas.Error('jme.texsubvars.no right brace',{op:cmd}));
            var expr = s.slice(si,i);
            s = s.slice(i+1);
            out.push(expr);
        }
        out.push(s);
        return out;
    },
    /** Dictionary of functions
     * type: function(value,display:boolean) -> string
     * which convert a JME token to a string for display
     */
    typeToDisplayString: {
        'number': function(v) {
            return ''+Numbas.math.niceNumber(v.value)+'';
        },
        'string': function(v,display) {
            return v.value;
        },
    },
    /** Produce a string representation of the given token, for display
     * @param {Numbas.jme.token} v
     * @see Numbas.jme.typeToDisplayString
     * @returns {String}
     */
    tokenToDisplayString: function(v) {
        if(v.type in jme.typeToDisplayString) {
            return jme.typeToDisplayString[v.type](v);
        } else {
            return jme.display.treeToJME({tok:v});
        }
    },
    /** Substitute variables into a text string (not maths).
     * @param {String} str
     * @param {Numbas.jme.Scope} scope
     * @param {Boolean} [display=false] - Is this string going to be displayed to the user? If so, avoid unnecessary brackets and quotes.
     */
    subvars: function(str, scope,display)
    {
        var bits = util.splitbrackets(str,'{','}');
        if(bits.length==1)
        {
            return str;
        }
        var out = '';
        for(var i=0; i<bits.length; i++)
        {
            if(i % 2)
            {
                var v = jme.evaluate(jme.compile(bits[i],scope),scope);
                if(display) {
                    v = jme.tokenToDisplayString(v);
                } else {
                    if(v.type=='number') {
                        v = '('+Numbas.jme.display.treeToJME({tok:v},{niceNumber: false})+')';
                    } else if(v.type=='string') {
                        v = "'"+v.value+"'";
                    } else {
                        v = jme.display.treeToJME({tok:v},{niceNumber: false});
                    }
                }
                out += v;
            }
            else
            {
                out+=bits[i];
            }
        }
        return out;
    },
    /** Unwrap a {@link Numbas.jme.token} into a plain JavaScript value
     * @param {Numbas.jme.token} v
     * @returns {Object}
     */
    unwrapValue: function(v) {
        switch(v.type) {
            case 'list':
                return v.value.map(jme.unwrapValue);
            case 'dict':
                var o = {};
                Object.keys(v.value).forEach(function(key) {
                    o[key] = jme.unwrapValue(v.value[key]);
                });
                return o;
            case 'name':
                return v.name;
            case 'expression':
                return v.tree;
            default:
                return v.value;
        }
    },
    /** Wrap up a plain JavaScript value (number, string, bool or array) as a {@link Numbas.jme.token}.
     * @param {Object} v
     * @param {String} typeHint - name of the expected type (to differentiate between, for example, matrices, vectors and lists
     * @returns {Numbas.jme.token}
     */
    wrapValue: function(v,typeHint) {
        switch(typeof v) {
        case 'number':
            return new jme.types.TNum(v);
        case 'string':
            var s = new jme.types.TString(v);
            s.safe = true;
            return s;
        case 'boolean':
            return new jme.types.TBool(v);
        default:
            switch(typeHint) {
                case 'html':
                    return v;
                default:
                    if(Array.isArray(v)) {
                        // it would be nice to abstract this, but some types need the arguments to be wrapped, while others don't
                        switch(typeHint) {
                        case 'matrix':
                            return new jme.types.TMatrix(v);
                        case 'vector':
                            return new jme.types.TVector(v);
                        case 'range':
                            return new jme.types.TRange(v);
                        case 'set':
                            v = v.map(jme.wrapValue);
                            return new jme.types.TSet(v);
                        default:
                            v = v.map(jme.wrapValue);
                            return new jme.types.TList(v);
                        }
                    } else if(v===null || v===undefined) { // CONTROVERSIAL! Cast null to the empty string, because we don't have a null type.
                        return new jme.types.TString('');
                    } else if(v!==null && typeof v=='object' && v.type===undefined) {
                        var o = {};
                        Object.keys(v).forEach(function(key) {
                            o[key] = jme.wrapValue(v[key]);
                        });
                        return new jme.types.TDict(o);
                    }
                    return v;
            }
        }
    },
    /** Is a token a TOp?
     *
     * @param {Numbas.jme.token}
     *
     * @returns {Boolean}
     */
    isOp: function(tok,op) {
        return tok.type=='op' && tok.name==op;
    },
    /** Is a token a TName?
     *
     * @param {Numbas.jme.token}
     *
     * @returns {Boolean}
     */
    isName: function(tok,name) {
        return tok.type=='name' && tok.name==name;
    },
    /** Is a token a TFunction?
     *
     * @param {Numbas.jme.token}
     *
     * @returns {Boolean}
     */
    isFunction: function(tok,name) {
        return tok.type=='function' && tok.name==name;
    },
    /** Does this expression behave randomly?
     *  True if it contains any instances of functions or operations, defined in the given scope, which could behave randomly.
     *
     *  @param {Numbas.jme.tree} expr
     *  @param {Numbas.jme.Scope} scope
     *  @returns {Boolean}
     */
    isRandom: function(expr,scope) {
        switch(expr.tok.type) {
            case 'op':
            case 'function':
                // a function application is random if its definition is marked as random,
                // or if any of its arguments are random
                var op = expr.tok.name.toLowerCase();
                var fns = scope.getFunction(op);
                if(fns) {
                    for(var i=0;i<fns.length;i++) {
                        var fn = fns[i]
                        if(fn.random===undefined && fn.language=='jme') {
                            fn.random = false; // put false in to avoid infinite recursion if fn is defined in terms of another function which itself uses fn
                            fn.random = jme.isRandom(fn.tree,scope);
                        }
                        if(fn.random) {
                            return true;
                        }
                    }
                }
                for(var i=0;i<expr.args.length;i++) {
                    if(jme.isRandom(expr.args[i],scope)) {
                        return true;
                    }
                }
                return false;
            default:
                if(!expr.args) {
                    return false;
                }
                for(var i=0;i<expr.args.length;i++) {
                    if(jme.isRandom(expr.args[i],scope)) {
                        return true;
                    }
                }
                return false;
        }
    },

    /** Is this a monomial - a single term of the form x^n or m*x^n, where m and n are numbers?
     * @param {Numbas.jme.tree}
     * @returns {Object} the degree of the monomial
     */
    isMonomial: function(tree) {
        function unwrapUnaryMinus(tree) {
            while(jme.isOp(tree.tok,'-u')) {
                tree = tree.args[0];
            }
            return tree;
        }
        var coefficient;
        if(jme.isOp(tree.tok,'*')) {
            if(unwrapUnaryMinus(tree.args[0]).tok.type!='number') {
                return false;
            }
            coefficient = tree.args[0];
            tree = tree.args[1];
        } else if(jme.isOp(tree.tok,'-u')) {
            coefficient = {tok:new TNum(-1)};
            tree = tree.args[0];
        } else {
            coefficient = {tok:new TNum(1)};
        }
        if(tree.tok.type=='name') {
            return {base:tree, degree:1, coefficient: coefficient};
        }
        if(jme.isOp(tree.tok,'^') && tree.args[0].tok.type=='name' && unwrapUnaryMinus(tree.args[1]).tok.type=='number') {
            return {base:tree.args[0], degree:tree.args[1].tok.value, coefficient: coefficient};
        }
        return false;
    }
};

/** Options for {@link Numbas.jme.Parser}
 *
 * @typedef {Object} Numbas.jme.parser_options
 * @property {Boolean} closeMissingBrackets - Silently ignore "missing right bracket" errors?
 * @property {Boolean} addMissingArguments - When an op or function call is missing required arguments, insert `?` as a placeholder.
 */

/** A parser for {@link JME} expressions
 * @memberof Numbas.jme
 * @constructor
 * 
 * @param {Numbas.jme.parser_options} options
 */
var Parser = jme.Parser = function(options) {
    this.options = util.extend_object({}, this.option_defaults, options);
}
jme.Parser.prototype = /** @lends Numbas.jme.Parser.prototype */ {
    /** Default options for new parsers
     * @type {Numbas.jme.parser_options}
     */
    option_defaults: {
        closeMissingBrackets: false,
        addMissingArguments: false
    },
    /** Regular expressions to match tokens 
     * @type {Object.<RegExp>}
     */
    re: {
        re_bool: /^(true|false)(?![a-zA-Z_0-9'])/i,
        re_number: /^[0-9]+(?:\x2E[0-9]+)?/,
        re_name: /^{?((?:(?:[a-zA-Z]+):)*)((?:\$?[a-zA-Z_][a-zA-Z0-9_]*'*)|\?\??|[π∞])}?/i,
        re_op: /^(\.\.|#|<=|>=|<>|&&|\|\||[\|*+\-\/\^<>=!&;÷×∈∧∨⟹≠≥≤]|(?:(not|and|or|xor|implies|isa|except|in|divides)([^a-zA-Z0-9_']|$)))/i,
        re_punctuation: /^([\(\),\[\]])/,
        re_string: /^("""|'''|['"])((?:[^\1\\]|\\.)*?)\1/,
        re_comment: /^\/\/.*(?:\n|$)/,
        re_keypair: /^:/
    },
    /** Convert given expression string to a list of tokens. Does some tidying, e.g. inserts implied multiplication symbols.
     * @param {JME} expr
     * @returns {Array.<Numbas.jme.token>}
     * @see Numbas.jme.Parser#compile
     */
    tokenise: function(expr) {
        if(!expr)
            return [];
        expr += '';
        var oexpr = expr;
        var pos = 0;
        var olen = expr.length;
        expr = expr.replace(this.re.re_strip_whitespace, '');    //get rid of whitespace
        pos += olen - expr.length;
        var tokens = [];
        var i = 0;
        while( expr.length ) {
            olen = expr.length;
            expr = expr.replace(this.re.re_strip_whitespace, '');    //get rid of whitespace
            pos += olen-expr.length;
            var token_pos= pos;
            var result;
            var token;
            while(result=expr.match(this.re.re_comment)) {
                olen = expr.length;
                expr=expr.slice(result[0].length).replace(this.re.re_strip_whitespace,'');
                pos += olen-expr.length;
            }
            if(result = expr.match(this.re.re_number)) {
                token = new TNum(result[0]);
                if(tokens.length>0 && (tokens[tokens.length-1].type==')' || tokens[tokens.length-1].type=='name'))    //right bracket followed by a number is interpreted as multiplying contents of brackets by number
                {
                    tokens.push(new TOp('*'));
                }
            } else if (result = expr.match(this.re.re_bool)) {
                token = new TBool(util.parseBool(result[0]));
                result[0] = result[1];
            } else if (result = expr.match(this.re.re_op)) {
                if(result[2])        //if word-ish operator
                    result[0] = result[2];
                token = result[0];
                //work out if operation is being used prefix or postfix
                var nt;
                var postfix = false;
                var prefix = false;
                if(token in opSynonyms) {
                    token = opSynonyms[token];
                }
                if( tokens.length==0 || (nt=tokens[tokens.length-1].type)=='(' || nt==',' || nt=='[' || (nt=='op' && !tokens[tokens.length-1].postfix) || nt=='keypair' )
                {
                    if(token in prefixForm) {
                        token = prefixForm[token];
                        prefix = true;
                    }
                }
                else
                {
                    if(token in postfixForm) {
                        token = postfixForm[token];
                        postfix = true;
                    }
                }
                token=new TOp(token,postfix,prefix);
            } else if (result = expr.match(this.re.re_name)) {
                var name = result[2];
                var annotation = result[1] ? result[1].split(':').slice(0,-1) : null;
                if(!annotation) {
                    var lname = name.toLowerCase();
                    // fill in constants here to avoid having more 'variables' than necessary
                    if(lname in jme.constants) {
                        token = new TNum(jme.constants[lname]);
                    } else {
                        token = new TName(name);
                    }
                } else {
                    token = new TName(name,annotation);
                }
                if(tokens.length>0 && (tokens[tokens.length-1].type=='number' || tokens[tokens.length-1].type=='name' || tokens[tokens.length-1].type==')')) {    //number or right bracket or name followed by a name, eg '3y', is interpreted to mean multiplication, eg '3*y'
                    tokens.push(new TOp('*'));
                }
            } else if (result = expr.match(this.re.re_punctuation)) {
                if(result[0]=='(' && tokens.length>0 && (tokens[tokens.length-1].type=='number' || tokens[tokens.length-1].type==')')) {    //number or right bracket followed by left parenthesis is also interpreted to mean multiplication
                    tokens.push(new TOp('*'));
                }
                token = new TPunc(result[0]);
            } else if (result = expr.match(this.re.re_string)) {
                var str = result[2];
                token = new TString(jme.unescape(str));
            } else if(result = expr.match(this.re.re_keypair)) {
                if(tokens.length==0 || tokens[tokens.length-1].type!='string') {
                    throw(new Numbas.Error('jme.tokenise.keypair key not a string',{type: tokens[tokens.length-1].type}));
                }
                token = new TKeyPair(tokens.pop().value);
            } else if(expr.length) {
                //invalid character or not able to match a token
                var position = oexpr.length - expr.length;
                var nearby = oexpr.slice(Math.max(0,position), position+5);
                throw(new Numbas.Error('jme.tokenise.invalid near',{expression:oexpr, position: position, nearby: nearby}));
            } else {
                break;
            }
            expr=expr.slice(result[0].length);    //chop found token off the expression
            pos += result[0].length;
            token.pos = token_pos;
            tokens.push(token);
        }
        return(tokens);
    },
    /** Shunt list of tokens into a syntax tree. Uses the shunting yard algorithm (wikipedia has a good description)
     * @param {Array.<Numbas.jme.token>} tokens
     * @returns {Numbas.jme.tree}
     * @see Numbas.jme.Parser#tokenise
     * @see Numbas.jme.Parser#compile
     */
    shunt: function(tokens) {
        var parser = this;
        var output = [];
        var stack = [];
        var numvars=[],olength=[],listmode=[];
        function addoutput(tok) {
            if(tok.vars!==undefined) {
                if(output.length<tok.vars) {
                    if(!parser.options.addMissingArguments) {
                        throw(new Numbas.Error('jme.shunt.not enough arguments',{op:tok.name || tok.type}));
                    } else {
                        for(var i=output.length;i<tok.vars;i++) {
                            var tvar = new types.TName('?');
                            tvar.added_missing = true;
                            output.push({tok:tvar});
                        }
                    }
                }
                var thing = {
                    tok: tok,
                    args: output.splice(output.length-tok.vars,tok.vars)
                };
                if(tok.type=='list') {
                    var mode = null;
                    for(var i=0;i<thing.args.length;i++) {
                        var argmode = thing.args[i].tok.type=='keypair' ? 'dictionary' : 'list';
                        if(i>0 && argmode!=mode) {
                            throw(new Numbas.Error('jme.shunt.list mixed argument types',{mode: mode, argmode: argmode}));
                        }
                        mode = argmode;
                    }
                    if(mode=='dictionary') {
                        thing.tok = new TDict();
                    }
                }
                output.push(thing);
            }
            else {
                output.push({tok:tok});
            }
        }
        var type_actions = {
            'number': addoutput,
            'string': addoutput,
            'boolean': addoutput,
            'name': function(tok) {
                // if followed by an open bracket, this is a function application
                if( i<tokens.length-1 && tokens[i+1].type=="(") {
                        if(funcSynonyms[tok.name]) {
                            tok.name=funcSynonyms[tok.name];
                        }
                        stack.push(new TFunc(tok.name,tok.annotation));
                        numvars.push(0);
                        olength.push(output.length);
                } else {
                    //this is a variable otherwise
                    addoutput(tok);
                }
            },
            ',': function(tok) {
                //reached end of expression defining function parameter, so pop all of its operations off stack and onto output
                while( stack.length && stack[stack.length-1].type != "(" && stack[stack.length-1].type != '[') {
                    addoutput(stack.pop())
                }
                numvars[numvars.length-1]++;
                if( ! stack.length ) {
                    throw(new Numbas.Error('jme.shunt.no left bracket in function'));
                }
            },
            'op': function(tok) {
                if(!tok.prefix) {
                    var o1 = precedence[tok.name];
                    //while ops on stack have lower precedence, pop them onto output because they need to be calculated before this one. left-associative operators also pop off operations with equal precedence
                    while(
                            stack.length &&
                            stack[stack.length-1].type=="op" &&
                            (
                             (o1 > precedence[stack[stack.length-1].name]) ||
                             (
                              leftAssociative(tok.name) &&
                              o1 == precedence[stack[stack.length-1].name]
                             )
                            )
                    ) {
                        addoutput(stack.pop());
                    }
                }
                stack.push(tok);
            },
            '[': function(tok) {
                if(i==0 || tokens[i-1].type=='(' || tokens[i-1].type=='[' || tokens[i-1].type==',' || tokens[i-1].type=='op' || tokens[i-1].type=='keypair') {
                    listmode.push('new');
                }
                else {
                    listmode.push('index');
                }
                stack.push(tok);
                numvars.push(0);
                olength.push(output.length);
            },
            ']': function(tok) {
                while( stack.length && stack[stack.length-1].type != "[" ) {
                    addoutput(stack.pop());
                }
                if( ! stack.length ) {
                    throw(new Numbas.Error('jme.shunt.no left square bracket'));
                } else {
                    stack.pop();    //get rid of left bracket
                }
                //work out size of list
                var n = numvars.pop();
                var l = olength.pop();
                if(output.length>l) {
                    n++;
                }
                switch(listmode.pop()) {
                case 'new':
                    addoutput(new TList(n))
                    break;
                case 'index':
                    var f = new TFunc('listval');
                    f.vars = 2;
                    addoutput(f);
                    break;
                }
            },
            '(': function(tok) {
                stack.push(tok);
            },
            ')': function(tok) {
                while( stack.length && stack[stack.length-1].type != "(" ) {
                    addoutput(stack.pop());
                }
                if( ! stack.length ) {
                    throw(new Numbas.Error('jme.shunt.no left bracket'));
                } else {
                    stack.pop();    //get rid of left bracket
                    //if this is a function call, then the next thing on the stack should be a function name, which we need to pop
                    if( stack.length && stack[stack.length-1].type=="function")
                    {
                        //work out arity of function
                        var n = numvars.pop();
                        var l = olength.pop();
                        if(output.length>l)
                            n++;
                        var f = stack.pop();
                        f.vars = n;
                        addoutput(f);
                    }
                }
            },
            'keypair': function(tok) {
                stack.push(tok);
            }
        };
        function shunt_token(tok) {
            if(tok.type in type_actions) {
                type_actions[tok.type](tok);
            }
        }
        for(var i = 0;i < tokens.length; i++ ) {
            var tok = tokens[i];
            shunt_token(tok);
        }
        //pop all remaining ops on stack into output
        while(stack.length) {
            var x = stack[stack.length-1];
            if(x.type=="(") {
                if(!this.options.closeMissingBrackets) {
                    throw(new Numbas.Error('jme.shunt.no right bracket'));
                } else {
                    type_actions[')']();
                }
            } else {
                stack.pop();
                addoutput(x);
            }
        }
        if(listmode.length>0) {
            throw(new Numbas.Error('jme.shunt.no right square bracket'));
        }
        if(output.length>1) {
            throw(new Numbas.Error('jme.shunt.missing operator'));
        }
        return(output[0]);
    },

    /** Compile an expression string to a syntax tree. (Runs {@link Numbas.jme.tokenise} then {@Link Numbas.jme.shunt})
     * @param {JME} expr
     * @see Numbas.jme.Parser#tokenise
     * @see Numbas.jme.Parser#shunt
     * @returns {Numbas.jme.tree}
     */
    compile: function(expr) {
        //make sure expression is a string and not a number or anything like that
        expr += '';
        if(!expr.trim().length) {
            return null;
        }
        //tokenise expression
        var tokens = this.tokenise(expr);
        //compile to parse tree
        var tree = this.shunt(tokens);
        if(tree===null) {
            return;
        }
        return(tree);
    },
}
/** Regular expression to match whitespace (because '\s' doesn't match *everything*) */
jme.Parser.prototype.re.re_whitespace = '(?:[\\s \\f\\n\\r\\t\\v\\u00A0\\u2028\\u2029]|(?:\&nbsp;))';
jme.Parser.prototype.re.re_strip_whitespace = new RegExp('^'+jme.Parser.prototype.re.re_whitespace+'+');

/** Regular expressions for parser tokens.
 * Included for backwards-compatibility
 * @type {Object.<RegExp>}
 * @see {Numbas.jme.Parser.re}
 */
jme.re = jme.Parser.prototype.re;

var fnSort = util.sortBy('id');
/** Options for the {@link Numbas.jme.funcObj} constructor
 * @typedef {Object} Numbas.jme.scope_deletions
 * @property {Object} variables - Names of deleted variables.
 * @property {Object} functions - Names of deleted functions.
 * @property {Object} rulesets - Names of deleted rulesets.
 */

/**
 * A JME evaluation environment.
 * Stores variable, function, and ruleset definitions.
 *
 * A scope may have a parent; elements of the scope are resolved by searching up through the hierarchy of parents until a match is found.
 *
 * @memberof Numbas.jme
 * @constructor
 * @property {Object.<Numbas.jme.token>} variables - Dictionary of variables defined **at this level in the scope**. To resolve a variable in the scope, use {@link Numbas.jme.Scope.getVariable}.
 * @property {Object.<Array.<Numbas.jme.funcObj>>} functions - Dictionary of functions defined at this level in the scope. Function names map to lists of functions: there can be more than one function for each name because of multiple dispatch. To resolve a function name in the scope, use {@link Numbas.jme.Scope.getFunction}.
 * @property {Object.<Numbas.jme.rules.Ruleset>} rulesets - Dictionary of rulesets defined at this level in the scope. To resolve a ruleset in the scope, use {@link Numbas.jme.Scope.getRuleset}.
 * @property {Numbas.jme.scope_deletions} deleted - Names of deleted variables/functions/rulesets.
 * @property {Numbas.Question} question - The question this scope belongs to.
 *
 * @param {Numbas.jme.Scope[]} scopes - Either: nothing, in which case this scope has no parents; a parent Scope object; a list whose first element is a parent scope, and the second element is a dictionary of extra variables/functions/rulesets to store in this scope
 */
var Scope = jme.Scope = function(scopes) {
    this.variables = {};
    this.functions = {};
    this._resolved_functions = {};
    this.rulesets = {};
    this.deleted = {
        variables: {},
        functions: {},
        rulesets: {}
    }
    if(scopes===undefined) {
        return;
    }
    if(!Array.isArray(scopes)) {
        scopes = [scopes,undefined];
    }
    this.question = scopes[0].question || this.question;
    var extras;
    if(!scopes[0].evaluate) {
        extras = scopes[0];
    } else {
        this.parent = scopes[0];
        extras = scopes[1] || {};
    }
    if(extras) {
        if(extras.variables) {
            for(var x in extras.variables) {
                this.setVariable(x,extras.variables[x]);
            }
        }
        this.rulesets = extras.rulesets || this.rulesets;
        this.functions = extras.functions || this.functions;
    }
    return;
}
Scope.prototype = /** @lends Numbas.jme.Scope.prototype */ {
    /** Add a JME function to the scope.
     * @param {Numbas.jme.funcObj} fn - function to add
     */
    addFunction: function(fn) {
        if(!(fn.name in this.functions)) {
            this.functions[fn.name] = [fn];
        } else {
            this.functions[fn.name].push(fn);
            delete this._resolved_functions[fn.name];
        }
    },
    /** Mark the given variable name as deleted from the scope.
     * @param {String} name
     */
    deleteVariable: function(name) {
        this.deleted.variables[name] = true;
    },
    /** Get the object with given name from the given collection
     * @param {String} collection - name of the collection. A property of this Scope object, i.e. one of `variables`, `functions`, `rulesets`.
     * @param {String} name - the name of the object to retrieve
     * @returns {Object}
     */
    resolve: function(collection,name) {
        var scope = this;
        while(scope) {
            if(scope.deleted[collection][name]) {
                return;
            }
            if(scope[collection][name]!==undefined) {
                return scope[collection][name];
            }
            scope = scope.parent;
        }
    },
    /** Find the value of the variable with the given name, if it's defined
     * @param {String} name
     * @returns {Numbas.jme.token}
     */
    getVariable: function(name) {
        return this.resolve('variables',name.toLowerCase());
    },
    /** Set the given variable name
     * @param {String} name
     * @param {Numbas.jme.token} value
     */
    setVariable: function(name, value) {
        this.variables[name.toLowerCase()] = value;
    },
    /** Get all definitions of the given function name.
     * @param {String} name
     * @returns {Numbas.jme.funcObj[]} A list of all definitions of the given name.
     */
    getFunction: function(name) {
        if(!this._resolved_functions[name]) {
            var scope = this;
            var o = [];
            while(scope) {
                if(scope.functions[name]!==undefined) {
                    o = o.merge(scope.functions[name],fnSort);
                }
                scope = scope.parent;
            }
            this._resolved_functions[name] = o;
        }
        return this._resolved_functions[name];
    },
    /** Get the ruleset with the gien name
     * @param {String} name
     * @returns {Numbas.jme.rules.Ruleset}
     */
    getRuleset: function(name) {
        return this.resolve('rulesets',name);
    },
    /** Set the given ruleset name
     * @param {String} name
     * @param {Numbas.jme.rules.Ruleset[]} rules
     */
    setRuleset: function(name, rules) {
        this.rulesets[name] = this.rulesets[name.toLowerCase()] = rules;
    },
    /** Collect together all items from the given collection
     * @param {String} collection - name of the collection. A property of this Scope object, i.e. one of `variables`, `functions`, `rulesets`.
     * @returns {Object} a dictionary of names to values
     */
    collect: function(collection,name) {
        var scope = this;
        var deleted = {};
        var out = {};
        var name;
        while(scope) {
            for(var name in scope.deleted[collection]) {
                deleted[name] = scope.deleted[collection][name];
            }
            for(name in scope[collection]) {
                if(!deleted[name]) {
                    out[name] = out[name] || scope[collection][name];
                }
            }
            scope = scope.parent;
        }
        return out;
    },
    /** Gather all variables defined in this scope
     * @returns {Object.<Numbas.jme.token>} a dictionary of variables
     */
    allVariables: function() {
        return this.collect('variables');
    },
    /** Gather all rulesets defined in this scope
     * @returns {Object.<Numbas.jme.rules.Ruleset>} a dictionary of rulesets
     */
    allRulesets: function() {
        return this.collect('rulesets');
    },
    /** Gather all functions defined in this scope
     * @returns {Object.<Numbas.jme.funcObj[]>} a dictionary of function definitions: each name maps to a list of @link{Numbas.jme.funcObj}
     */
    allFunctions: function() {
        var scope = this;
        var out = {}
        var name;
        function add(name,fns) {
            if(!out[name]) {
                out[name] = [];
            }
            out[name] = out[name].merge(fns,fnSort);
        }
        while(scope) {
            for(var name in scope.functions) {
                add(name,scope.functions[name])
            }
            scope = scope.parent;
        }
        return out;
    },
    /** Gather all members of this scope into this scope object.
     * A backwards-compatibility hack for questions that use `question.scope.variables.x`
     * Shouldn't be applied to any scope other than the question scope.
     */
    flatten: function() {
        this.variables = this.allVariables();
        this.rulesets = this.allRulesets();
    },
    /** Evaluate an expression in this scope - equivalent to `Numbas.jme.evaluate(expr,this)`
     * @param {JME} expr
     * @param {Object.<Numbas.jme.token|Object>} [variables] - Dictionary of variables to sub into expression. Values are automatically wrapped up as JME types, so you can pass raw JavaScript values.
     * @param {Boolean} [noSubstitution] - if true, don't substitute variable values from the scope into the expression.
     * @returns {Numbas.jme.token}
     */
    evaluate: function(expr,variables, noSubstitution) {
        var scope = this;
        if(variables) {
            scope = new Scope([this]);
            for(var name in variables) {
                scope.variables[name] = jme.wrapValue(variables[name]);
            }
        }
        //if a string is given instead of an expression tree, compile it to a tree
        var tree;
        if( typeof(expr)=='string' ) {
            tree = jme.compile(expr,scope);
        } else {
            tree = expr;
        }
        if(!tree) {
            return null;
        }
        if(!noSubstitution) {
            tree = jme.substituteTree(tree,scope,true);
        }
        var tok = tree.tok;
        switch(tok.type)
        {
        case 'number':
        case 'boolean':
        case 'range':
            return tok;
        case 'list':
            if(tok.value===undefined)
            {
                var value = [];
                for(var i=0;i<tree.args.length;i++)
                {
                    value[i] = scope.evaluate(tree.args[i],null,noSubstitution);
                }
                tok = new TList(value);
            }
            return tok;
        case 'dict':
            if(tok.value===undefined) {
                var value = {};
                for(var i=0;i<tree.args.length;i++) {
                    var kp = tree.args[i];
                    value[kp.tok.key] = scope.evaluate(kp.args[0],null,noSubstitution);
                }
                tok = new TDict(value);
            }
            return tok;
        case 'string':
            var value = tok.value;
            if(!tok.safe && value.contains('{')) {
                value = jme.contentsubvars(value,scope)
                var t = new TString(value);
                t.latex = tok.latex
                return t;
            } else {
                return tok;
            }
        case 'name':
            var v = scope.getVariable(tok.name.toLowerCase());
            if(v && !noSubstitution) {
                return v;
            } else {
                tok = new TName(tok.name);
                tok.unboundName = true;
                return tok;
            }
        case 'op':
        case 'function':
            var op = tok.name.toLowerCase();
            if(lazyOps.indexOf(op)>=0) {
                return scope.getFunction(op)[0].evaluate(tree.args,scope);
            }
            else {
                var args = [];
                for(var i=0;i<tree.args.length;i++) {
                    args.push(scope.evaluate(tree.args[i],null,noSubstitution));
                }
                var matchedFunction;
                var fns = scope.getFunction(op);
                if(fns.length==0)
                {
                    if(tok.type=='function') {
                        //check if the user typed something like xtan(y), when they meant x*tan(y)
                        var possibleOp = op.slice(1);
                        if(op.length>1 && scope.getFunction(possibleOp).length) {
                            throw(new Numbas.Error('jme.typecheck.function maybe implicit multiplication',{name:op,first:op[0],possibleOp:possibleOp}));
                        } else {
                            throw(new Numbas.Error('jme.typecheck.function not defined',{op:op,suggestion:op}));
                        }
                    }
                    else {
                        throw(new Numbas.Error('jme.typecheck.op not defined',{op:op}));
                    }
                }
                for(var j=0;j<fns.length; j++)
                {
                    var fn = fns[j];
                    if(fn.typecheck(args))
                    {
                        matchedFunction = fn;
                        break;
                    }
                }
                if(matchedFunction)
                    return matchedFunction.evaluate(args,scope);
                else {
                    for(var i=0;i<=args.length;i++) {
                        if(args[i] && args[i].unboundName) {
                            throw(new Numbas.Error('jme.typecheck.no right type unbound name',{name:args[i].name}));
                        }
                    }
                    throw(new Numbas.Error('jme.typecheck.no right type definition',{op:op}));
                }
            }
        default:
            return tok;
        }
    }
};
/** @typedef {Object} Numbas.jme.token
 * @property {String} type
 * @see Numbas.jme.types
 */
/** The data types supported by JME expressions
 * @namespace Numbas.jme.types
 */
var types = jme.types = {}
/** Nothing type.
 * @memberof Numbas.jme.types
 * @augments Numbas.jme.token
 * @constructor
 */
var TNothing = types.TNothing = types.nothing = function() {};
TNothing.prototype.type = 'nothing';
/** Number type.
 * @memberof Numbas.jme.types
 * @augments Numbas.jme.token
 * @property {Number} value
 * @property {String|Number|complex} originalValue - the value used to construct the token - either a string, a number, or a complex number object
 * @property type "number"
 * @constructor
 * @param {Number} num
 */
var TNum = types.TNum = types.number = function(num)
{
    if(num===undefined)
        return;
    this.originalValue = num;
    switch(typeof(num)) {
        case 'object':
            if(num.complex) {
                this.value = num;
            } else {
                throw(new Numbas.Error("jme.tokenise.number.object not complex"));
            }
            break;
        case "number":
            this.value = num;
            break;
        case "string":
            this.value = parseFloat(num);
            break;
    }
    this.value = num.complex ? num : parseFloat(num);
}
TNum.prototype.type = 'number';
TNum.doc = {
    name: 'number',
    usage: ['0','1','0.234','i','e','pi'],
    description: "@i@, @e@, @infinity@ and @pi@ are reserved keywords for the imaginary unit, the base of the natural logarithm, $\\infty$ and $\\pi$, respectively."
};
/** String type.
 * @memberof Numbas.jme.types
 * @augments Numbas.jme.token
 * @property {String} value
 * @property {Boolean} latex - is this string LaTeX code? If so, it's displayed as-is in math mode
 * @property {Boolean} safe - if true, don't run {@link Numbas.jme.subvars} on this token when it's evaluated
 * @property {String} type "string"
 * @constructor
 * @param {String} s
 */
var TString = types.TString = types.string = function(s)
{
    this.value = s;
}
TString.prototype.type = 'string';
TString.doc = {
    name: 'string',
    usage: ['\'hello\'','"hello"'],
    description: "Use strings to create non-mathematical text."
};
/** Boolean type
 * @memberof Numbas.jme.types
 * @augments Numbas.jme.token
 * @property {Boolean} value
 * @property type "boolean"
 * @constructor
 * @param {Boolean} b
 */
var TBool = types.TBool = types.boolean = function(b)
{
    this.value = b;
}
TBool.prototype.type = 'boolean';
TBool.doc = {
    name: 'boolean',
    usage: ['true','false'],
    description: "Booleans represent either truth or falsity. The logical operations @and@, @or@ and @xor@ operate on and return booleans."
}
/** HTML DOM element
 * @memberof Numbas.jme.types
 * @augments Numbas.jme.token
 * @property {Element} value
 * @property type "html"
 * @constructor
 * @param {Element} html
 */
var THTML = types.THTML = types.html = function(html) {
    if(html.ownerDocument===undefined && !html.jquery) {
        throw(new Numbas.Error('jme.thtml.not html'));
    }
    if(window.jQuery) {
        this.value = $(html);
    } else {
        var elem = document.createElement('div');
        elem.innerHTML = html;
        this.value = elem.children;
    }
}
THTML.prototype.type = 'html';
THTML.doc = {
    name: 'html',
    usage: ['html(\'<div>things</div>\')'],
    description: "An HTML DOM node."
}
/** List of elements of any data type
 * @memberof Numbas.jme.types
 * @augments Numbas.jme.token
 * @property {Number} vars - Length of list
 * @property {Array.<Numbas.jme.token>} value - Values (may not be filled in if the list was created empty)
 * @property type "html"
 * @constructor
 * @param {Number|Array.<Numbas.jme.token>} value - Either the size of the list, or an array of values
 */
var TList = types.TList = types.list = function(value)
{
    switch(typeof(value))
    {
    case 'number':
        this.vars = value;
        break;
    case 'object':
        this.value = value;
        this.vars = value.length;
        break;
    default:
        this.vars = 0;
    }
}
TList.prototype.type = 'list';
TList.doc = {
    name: 'list',
    usage: ['[0,1,2,3]','[a,b,c]','[true,false,false]'],
    description: "A list of elements of any data type."
};
/** Key-value pair assignment
 * @memberof Numbas.jme.types
 * @augments Numbas.jme.token
 * @property {String} key
 * @constructor
 * @param {String} key
 */
var TKeyPair = types.TKeyPair = types.keypair = function(key) {
    this.key = key;
}
TKeyPair.prototype = {
    type: 'keypair',
    vars: 1
}
/** Dictionary: map strings to values
 * @memberof Numbas.jme.types
 * @augments Numbas.jme.token
 * @property {Object.<Numbas.jme.token>} value - Map strings to tokens. Undefined until this token is evaluated.
 * @property type "dict"
 * @constructor
 * @param {Object.<Numbas.jme.token>} value
 */
var TDict = types.TDict = types.dict = function(value) {
    this.value = value;
}
TDict.prototype = {
    type: 'dict'
}
/** Set type: a collection of elements, with no duplicates
 * @memberof Numbas.jme.types
 * @augments Numbas.jme.token
 * @property {Array.<Numbas.jme.token>} value - Array of elements. Constructor assumes all elements are distinct
 * @property type "set"
 * @constructor
 * @param {Array.<Numbas.jme.token>} value
 */
var TSet = types.TSet = types.set = function(value) {
    this.value = value;
}
TSet.prototype.type = 'set';
/** Vector type
 * @memberof Numbas.jme.types
 * @augments Numbas.jme.token
 * @property {Array.<Number>} value - Array of components
 * @property type "vector"
 * @constructor
 * @param {Array.<Number>} value
 */
var TVector = types.TVector = types.vector = function(value)
{
    this.value = value;
}
TVector.prototype.type = 'vector';
TVector.doc = {
    name: 'vector',
    usage: ['vector(1,2)','vector([1,2,3,4])'],
    description: 'The components of a vector must be numbers.\n\n When combining vectors of different dimensions, the smaller vector is padded with zeros to make up the difference.'
}
/** Matrix type
 * @memberof Numbas.jme.types
 * @augments Numbas.jme.token
 * @property {matrix} value - Array of rows (which are arrays of numbers)
 * @property type "matrix"
 * @constructor
 * @param {matrix} value
 */
var TMatrix = types.TMatrix = types.matrix = function(value)
{
    this.value = value;
    if(arguments.length>0) {
        if(value.length!=value.rows) {
            throw(new Numbas.Error("jme.matrix.reports bad size"));
        }
        if(value.rows>0 && value[0].length!=value.columns) {
            throw(new Numbas.Error("jme.matrix.reports bad size"));
        }
    }
}
TMatrix.prototype.type = 'matrix';
TMatrix.doc = {
    name: 'matrix',
    usage: ['matrix([1,2,3],[4,5,6])','matrix(row1,row2)'],
    description: "Matrices are constructed from lists of numbers, representing the rows.\n\n When combining matrices of different dimensions, the smaller matrix is padded with zeros to make up the difference."
}
/** A range of numerical values - either discrete or continuous
 * @memberof Numbas.jme.types
 * @augments Numbas.jme.token
 * @property {Array.<Number>} value - `[start,end,step]`
 * @property {Number} size - the number of values in the range (if it's discrete, `undefined` otherwise)
 * @property {Number} start - the lower bound of the range
 * @property {Number} end - the upper bound of the range
 * @property {Number} step - the difference between elements in the range
 * @property type "range"
 * @constructor
 * @param {Array.<Number>} range - `[start,end,step]`
 */
var TRange = types.TRange = types.range = function(range)
{
    this.value = range;
    if(this.value!==undefined)
    {
        this.start = this.value[0];
        this.end = this.value[1];
        this.step = this.value[2];
        this.size = Math.floor((this.end-this.start)/this.step);
    }
}
TRange.prototype.type = 'range';
TRange.doc = {
    name: 'range',
    usage: ['1..3','1..3#0.1','1..3#0'],
    description: 'A range @a..b#c@ represents the set of numbers $\\{a+nc | 0 \\leq n \\leq \\frac{b-a}{c} \\}$. If the step size is zero, then the range is the continuous interval $\[a,b\]$.'
}
/** Variable name token
 * @memberof Numbas.jme.types
 * @augments Numbas.jme.token
 * @property {String} name
 * @property {String} value - Same as `name`
 * @property {Array.<String>} annotation - List of annotations (used to modify display)
 * @property type "name"
 * @constructor
 * @param {String} name
 * @param {Array.<String>} annotation
 */
var TName = types.TName = types.name = function(name,annotation)
{
    this.name = name;
    this.value = name;
    this.annotation = annotation;
}
TName.prototype.type = 'name';
TName.doc = {
    name: 'name',
    usage: ['x','X','x1','longName','dot:x','vec:x'],
    description: 'A variable or function name. Names are case-insensitive, so @x@ represents the same thing as @X@. \
\n\n\
@e@, @i@ and @pi@ are reserved names representing mathematical constants. They are rewritten by the interpreter to their respective numerical values before evaluation. \
\n\n\
Names can be given _annotations_ to change how they are displayed. The following annotations are built-in:\
\n\n\
* @verb@ - does nothing, but names like @i@, @pi@ and @e@ are not interpreted as the famous mathematical constants.\n\
* @op@ - denote the name as the name of an operator -- wraps the name in the LaTeX @\\operatorname@ command when displayed\n\
* @v@ or @vector@ - denote the name as representing a vector -- the name is displayed in boldface\n\
* @unit@ - denote the name as representing a unit vector -- places a hat above the name when displayed\n\
* @dot@ - places a dot above the name when displayed, for example when representing a derivative\n\
* @m@ or @matrix@ - denote the name as representing a matrix -- displayed using a non-italic font\
\n\n\
Any other annotation is taken to be a LaTeX command. For example, a name @vec:x@ is rendered in LaTeX as <code>\\vec{x}</code>, which places an arrow above the name.\
    '
};
/** JME function token
 * @memberof Numbas.jme.types
 * @augments Numbas.jme.token
 * @property {String} name
 * @property {Array.<String>} annotation - List of annotations (used to modify display)
 * @property {Number} vars - Arity of the function
 * @property type "function"
 * @constructor
 * @param {String} name
 * @param {Array.<String>} annotation
 */
var TFunc = types.TFunc = types['function'] = function(name,annotation)
{
    this.name = name;
    this.annotation = annotation;
}
TFunc.prototype.type = 'function';
TFunc.prototype.vars = 0;
/** Unary/binary operation token
 * @memberof Numbas.jme.types
 * @augments Numbas.jme.token
 * @property {String} name
 * @property {Number} vars - Arity of the operation
 * @property {Boolean} postfix
 * @property {Boolean} prefix
 * @properrty type "op"
 * @constructor
 * @param {String} op - Name of the operation
 * @param {Boolean} postfix
 * @param {Boolean} prefix
 */
var TOp = types.TOp = types.op = function(op,postfix,prefix)
{
    var arity = 2;
    if(jme.arity[op]!==undefined)
        arity = jme.arity[op];
    this.name = op;
    this.postfix = postfix || false;
    this.prefix = prefix || false;
    this.vars = arity;
}
TOp.prototype.type = 'op';
/** Punctuation token
 * @memberof Numbas.jme.types
 * @augments Numbas.jme.token
 * @property {String} type - The punctuation character
 * @constructor
 * @param {String} kind - The punctuation character
 */
var TPunc = types.TPunc = function(kind)
{
    this.type = kind;
}
var TExpression = types.TExpression = types.expression = function(tree) {
    if(typeof(tree)=='string') {
        tree = jme.compile(tree);
    }
    this.tree = tree;
}
TExpression.prototype = {
    type: 'expression'
}
/** Arities of built-in operations
 * @readonly
 * @memberof Numbas.jme
 * @enum {Number} */
var arity = jme.arity = {
    '!': 1,
    'not': 1,
    'fact': 1,
    '+u': 1,
    '-u': 1
}
/** Some names represent different operations when used as prefix. This dictionary translates them.
 * @readonly
 * @memberof Numbas.jme
 * @enum {String}
 */
var prefixForm = {
    '+': '+u',
    '-': '-u',
    '!': 'not'
}
/** Some names represent different operations when used as prefix. This dictionary translates them.
 * @readonly
 * @memberof Numbas.jme
 * @enum {String}
 */
var postfixForm = {
    '!': 'fact'
}
/** Operator precedence
 * @enum {Number}
 * @memberof Numbas.jme
 * @readonly
 */
var precedence = jme.precedence = {
    ';': 0,
    'fact': 1,
    'not': 1,
    '+u': 2.5,
    '-u': 2.5,
    '^': 2,
    '*': 3,
    '/': 3,
    '+': 4,
    '-': 4,
    '|': 5,
    '..': 5,
    '#':6,
    'except': 6.5,
    'in': 6.5,
    '<': 7,
    '>': 7,
    '<=': 7,
    '>=': 7,
    '<>': 8,
    '=': 8,
    'isa': 9,
    'and': 11,
    'or': 12,
    'xor': 13,
    'implies': 14,
    ':': 100
};
/** Synonyms of operator names - keys in this dictionary are translated to their corresponding values
 * @enum {String}
 * @memberof Numbas.jme
 * @readonly
 */
var opSynonyms = jme.opSynonyms = {
    '&':'and',
    '&&':'and',
    'divides': '|',
    '||':'or',
    '÷': '/',
    '×': '*',
    '∈': 'in',
    '∧': 'and',
    '∨': 'or',
    '⟹': 'implies',
    '≠': '<>',
    '≥': '>=',
    '≤': '<='
}
/** Synonyms of function names - keys in this dictionary are translated to their corresponding values
 * @enum {String}
 * @memberof Numbas.jme
 * @readonly
 */
var funcSynonyms = jme.funcSynonyms = {
    'sqr':'sqrt',
    'gcf': 'gcd',
    'sgn':'sign',
    'len': 'abs',
    'length': 'abs',
    'verb': 'verbatim'
};
/** Operations which evaluate lazily - they don't need to evaluate all of their arguments
 * @memberof Numbas.jme
 */
var lazyOps = jme.lazyOps = ['if','switch','repeat','map','let','isa','satisfy','filter','isset','dict','safe'];
var rightAssociative = {
    '^': true,
    '+u': true,
    '-u': true
}
function leftAssociative(op)
{
    // check for left-associativity because that is the case when you do something more
    // exponentiation is only right-associative operation at the moment
    return !(op in rightAssociative);
};
/** Operations which commute.
 * @enum {Boolean}
 * @memberof Numbas.jme
 * @readonly
 */
var commutative = jme.commutative =
{
    '*': true,
    '+': true,
    'and': true,
    '=': true
};
/** A function which checks whether a {@link Numbas.jme.funcObj} can be applied to the given arguments.
 * @callback Numbas.jme.typecheck_fn
 * @param {Array.<Numbas.jme.token>} variables
 * @returns {Boolean}
 */
/** Evaluate a JME function on a list of arguments and in a given scope.
 * @callback Numbas.jme.evaluate_fn
 * @param {Array.<Numbas.jme.tree|Numbas.jme.token|Object>} args - Arguments of the function. If the function is {@link Numbas.jme.lazyOps|lazy}, syntax trees are passed, otherwise arguments are evaluated to JME tokens first. If the {@link Numbas.jme.funcObj_options|unwrapValues} option is set, the arguments are unwrapped to raw JavaScript values.
 * @param {Numbas.jme.Scope} scope - Scope in which the function is evaluated.
 * @returns {Numbas.jme.token|Object} If {@link Numbas.jme.funcObj_options|unwrapValues} is set,
 */
/** Options for the {@link Numbas.jme.funcObj} constructor
 * @typedef {Object} Numbas.jme.funcObj_options
 * @property {Numbas.jme.typecheck_fn} typecheck - Check that this function can be evaluated on the given arguments.
 * @property {Numbas.jme.evaluate_fn} evaluate - Evaluate the function on a list of arguments and in a given scope.
 * @property {Boolean} unwrapValues - Unwrap list elements in arguments into javascript primitives before passing to the evaluate function?
 */
var funcObjAcc = 0;    //accumulator for ids for funcObjs, so they can be sorted
/**
 * A JME function. Capable of confirming that it can be evaluated on a given list of arguments, and returning the result of its evaluation on a list of arguments inside a given scope.
 *
 * @memberof Numbas.jme
 * @constructor
 * @param {String} name
 * @param {Array.<function|String>} intype - A list of data type constructors for the function's paramters' types. Use the string '?' to match any type. Or, give the type's name with a '*' in front to match any number of that type. If `null`, then `options.typecheck` is used.
 * @param {function} outcons - The constructor for the output value of the function
 * @param {Numbas.jme.evaluate_fn} fn - JavaScript code which evaluates the function.
 * @param {Numbas.jme.funcObj_options} options
 *
 */
var funcObj = jme.funcObj = function(name,intype,outcons,fn,options)
{
    /** Globally unique ID of this function object
     * @name id
     * @member {Number}
     * @memberof Numbas.jme.funcObj
     */
    this.id = funcObjAcc++;
    options = options || {};
    for(var i=0;i<intype.length;i++)
    {
        if(intype[i]!='?' && intype[i]!='?*')
        {
            if(intype[i][0]=='*')
            {
                var type = types[intype[i].slice(1)];
                intype[i] = '*'+type.prototype.type;
            }
            else
            {
                intype[i]=intype[i].prototype.type;
            }
        }
    }
    name = name.toLowerCase();
    /** Name
     * @name name
     * @member {String}
     * @memberof Numbas.jme.funcObj
     */
    this.name=name;
    /** Calling signature of this function. A list of types - either token constructors; '?', representing any type; a type name. A type name or '?' followed by '*' means any number of arguments matching that type.
     *
     * @name intype
     * @member {Array.<Numbas.jme.token|String>}
     * @memberof Numbas.jme.funcObj
     */
    this.intype = intype;
    /** The return type of this function. Either a Numbas.jme.token constructor function, or the string '?', meaning unknown type.
     * @name outtype
     * @member {function|String}
     * @memberof Numbas.jme.funcObj
     */
    if(typeof(outcons)=='function')
        this.outtype = outcons.prototype.type;
    else
        this.outtype = '?';
    this.outcons = outcons;
    /** Javascript function for the body of this function
     * @name fn
     * @member {function}
     * @memberof Numbas.jme.funcObj
     */
    this.fn = fn;
    /** Can this function be called with the given list of arguments?
     * @function typecheck
     * @param {Numbas.jme.token[]} variables
     * @returns {Boolean}
     * @memberof Numbas.jme.funcObj
     */
    this.typecheck = options.typecheck || function(variables)
    {
        variables = variables.slice();    //take a copy of the array
        for( var i=0; i<this.intype.length; i++ )
        {
            if(this.intype[i][0]=='*')    //arbitrarily many
            {
                var ntype = this.intype[i].slice(1);
                while(variables.length)
                {
                    if(variables[0].type==ntype || ntype=='?' || variables[0].type=='?')
                        variables = variables.slice(1);
                    else
                        return false;
                }
            }else{
                if(variables.length==0)
                    return false;
                if(variables[0].type==this.intype[i] || this.intype[i]=='?' || variables[0].type=='?')
                    variables = variables.slice(1);
                else
                    return false;
            }
        }
        if(variables.length>0)    //too many args supplied
            return false;
        else
            return true;
    };
    /** Evaluate this function on the given arguments, in the given scope.
     *
     * @function evaluate
     * @param {Numbas.jme.token[]} args
     * @param {Numbas.jme.Scope} scope
     * @returns {Numbas.jme.token}
     * @memberof Numbas.jme.funcObj
     */
    this.evaluate = options.evaluate || function(args,scope)
    {
        var nargs = [];
        for(var i=0; i<args.length; i++) {
            if(options.unwrapValues)
                nargs.push(jme.unwrapValue(args[i]));
            else
                nargs.push(args[i].value);
        }
        var result = this.fn.apply(null,nargs);
        if(options.unwrapValues) {
            result = jme.wrapValue(result);
            if(!result.type)
                result = new this.outcons(result);
        }
        else
            result = new this.outcons(result);
        if(options.latex) {
            result.latex = true;
        }
        return result;
    }
    this.doc = options.doc;
    /** Does this function behave randomly?
     * @name random
     * @member {Boolean}
     * @memberof Numbas.jme.funcObj
     */
    this.random = options.random;
}
function randoms(varnames,min,max,times)
{
    times *= varnames.length;
    var rs = [];
    for( var i=0; i<times; i++ )
    {
        var r = {};
        for( var j=0; j<varnames.length; j++ )
        {
            r[varnames[j]] = new TNum(Numbas.math.randomrange(min,max));
        }
        rs.push(r);
    }
    return rs;
}
function varnamesAgree(array1, array2) {
    var name;
    for(var i=0; i<array1.length; i++) {
        if( (name=array1[i])[0]!='$' && !array2.contains(name) )
            return false;
    }
    return true;
};
/** Decide if two numbers are close enough to count as equal.
 * @callback Numbas.jme.checkingFunction
 * @param {Number} r1
 * @param {Number} r2
 * @param {Number} tolerance - A measure of how close the results need to be to count as equal. What this means depends on the checking function.
 * @returns {Boolean} - True if `r1` and `r2` are close enough to be equal.
 */
/**
 * Numerical comparison functions
 * @enum {Numbas.jme.checkingFunction}
 * @memberof Numbas.jme
 */
var checkingFunctions = jme.checkingFunctions =
{
    /** Absolute difference between variables - fail if `Math.abs(r1-r2)` is bigger than `tolerance` */
    absdiff: function(r1,r2,tolerance)
    {
        if(r1===Infinity || r1===-Infinity)
            return r1===r2;
        return math.leq(math.abs(math.sub(r1,r2)), Math.abs(tolerance));
    },
    /** Relative (proportional) difference between variables - fail if `r1/r2 - 1` is bigger than `tolerance` */
    reldiff: function(r1,r2,tolerance) {
        if(r1===Infinity || r1===-Infinity)
            return r1===r2;
        //
        if(r2!=0) {
            return math.leq(Math.abs(math.sub(r1,r2)), Math.abs(math.mul(tolerance,r2)));
        } else {    //or if correct answer is 0, checks abs difference
            return math.leq(Math.abs(math.sub(r1,r2)), tolerance);
        }
    },
    /** Round both values to `tolerance` decimal places, and fail if unequal. */
    dp: function(r1,r2,tolerance) {
        if(r1===Infinity || r1===-Infinity)
            return r1===r2;
        tolerance = Math.floor(Math.abs(tolerance));
        return math.eq( math.precround(r1,tolerance), math.precround(r2,tolerance) );
    },
    /** Round both values to `tolerance` significant figures, and fail if unequal. */
    sigfig: function(r1,r2,tolerance) {
        if(r1===Infinity || r1===-Infinity)
            return r1===r2;
        tolerance = Math.floor(Math.abs(tolerance));
        return math.eq(math.siground(r1,tolerance), math.siground(r2,tolerance));
    }
};
/** Custom substituteTree behaviour for specific functions - for a given usage of a function, substitute in variable values from the scope.
 *
 * Functions have the signature <tree with function call at the top, scope, allowUnbound>
 *
 * @memberof Numbas.jme
 * @enum {Numbas.jme.substituteTree}
 * @see Numbas.jme.substituteTree
 */
var substituteTreeOps = jme.substituteTreeOps = {};
/** Custom findvars behaviour for specific functions - for a given usage of a function, work out which variables it depends on.
 *
 * @memberof Numbas.jme
 * @enum {Numbas.jme.findvars}
 * @see Numbas.jme.findvars
 */
var findvarsOps = jme.findvarsOps = {}
/** Find all variables used in given syntax tree
 * @memberof Numbas.jme
 * @method
 * @param {Numbas.jme.tree} tree
 * @param {Array.<String>} boundvars - variables to be considered as bound (don't include them)
 * @param {Numbas.jme.Scope} scope
 * @returns {Array.<String>}
 */
var findvars = jme.findvars = function(tree,boundvars,scope)
{
    if(!scope)
        scope = jme.builtinScope;
    if(boundvars===undefined)
        boundvars = [];
    if(tree.tok.type=='function' && tree.tok.name in findvarsOps) {
        return findvarsOps[tree.tok.name](tree,boundvars,scope);
    }
    if(tree.args===undefined)
    {
        switch(tree.tok.type)
        {
        case 'name':
            var name = tree.tok.name.toLowerCase();
            if(boundvars.indexOf(name)==-1)
                return [name];
            else
                return [];
            break;
        case 'string':
            if(tree.tok.safe) {
                return [];
            }
            var bits = util.contentsplitbrackets(tree.tok.value);
            var out = [];
            for(var i=0;i<bits.length;i+=4)
            {
                var plain = bits[i];
                var sbits = util.splitbrackets(plain,'{','}');
                for(var k=1;k<sbits.length-1;k+=2)
                {
                    var tree2 = jme.compile(sbits[k],scope,true);
                    out = out.merge(findvars(tree2,boundvars));
                }
                if(i<=bits.length-3) {
                    var tex = bits[i+2];
                    var tbits = jme.texsplit(tex);
                    for(var j=0;j<tbits.length;j+=4) {
                        var cmd = tbits[j+1];
                        var expr = tbits[j+3];
                        switch(cmd)
                        {
                        case 'var':
                            var tree2 = jme.compile(expr,scope,true);
                            out = out.merge(findvars(tree2,boundvars));
                            break;
                        case 'simplify':
                            var sbits = util.splitbrackets(expr,'{','}');
                            for(var k=1;k<sbits.length-1;k+=2)
                            {
                                var tree2 = jme.compile(sbits[k],scope,true);
                                out = out.merge(findvars(tree2,boundvars));
                            }
                            break;
                        }
                    }
                }
            }
            return out;
        default:
            return [];
        }
    }
    else
    {
        var vars = [];
        for(var i=0;i<tree.args.length;i++)
            vars = vars.merge(findvars(tree.args[i],boundvars));
        return vars;
    }
}
/** Check that two values are equal
 * @memberof Numbas.jme
 * @method
 * @param {Numbas.jme.token} r1
 * @param {Numbas.jme.token} r2
 * @param {function} checkingFunction - one of {@link Numbas.jme.checkingFunctions}
 * @param {Number} checkingAccuracy
 * @returns {Boolean}
 */
var resultsEqual = jme.resultsEqual = function(r1,r2,checkingFunction,checkingAccuracy)
{    // first checks both expressions are of same type, then uses given checking type to compare results
    var v1 = r1.value, v2 = r2.value;
    if(r1.type != r2.type)
    {
        return false;
    }
    switch(r1.type)
    {
    case 'number':
        if(v1.complex || v2.complex)
        {
            if(!v1.complex)
                v1 = {re:v1, im:0, complex:true};
            if(!v2.complex)
                v2 = {re:v2, im:0, complex:true};
            return checkingFunction(v1.re, v2.re, checkingAccuracy) && checkingFunction(v1.im,v2.im,checkingAccuracy);
        }
        else
        {
            return checkingFunction( v1, v2, checkingAccuracy );
        }
        break;
    case 'vector':
        if(v1.length != v2.length)
            return false;
        for(var i=0;i<v1.length;i++)
        {
            if(!resultsEqual(new TNum(v1[i]),new TNum(v2[i]),checkingFunction,checkingAccuracy))
                return false;
        }
        return true;
        break;
    case 'matrix':
        if(v1.rows != v2.rows || v1.columns != v2.columns)
            return false;
        for(var i=0;i<v1.rows;i++)
        {
            for(var j=0;j<v1.columns;j++)
            {
                if(!resultsEqual(new TNum(v1[i][j]||0),new TNum(v2[i][j]||0),checkingFunction,checkingAccuracy))
                    return false;
            }
        }
        return true;
        break;
    case 'list':
        if(v1.length != v2.length)
            return false;
        for(var i=0;i<v1.length;i++)
        {
            if(!resultsEqual(v1[i],v2[i],checkingFunction,checkingAccuracy))
                return false;
        }
        return true;
    default:
        return util.eq(r1,r2);
    }
};

/** List names of variables used in `tree`, obtained by depth-first search.
 *
 * Differs from {@link Numbas.jme.findvars} by including duplicates, and ignoring {@link Numbas.jme.findvarsOps}.
 * 
 * @memberof Numbas.jme
 * @method
 * @param {Numbas.jme.tree} tree
 * @returns {String[]}
 */
var varsUsed = jme.varsUsed = function(tree) {
    switch(tree.tok.type) {
        case 'name':
            return [tree.tok.name];
        case 'op':
        case 'function':
            var o = [];
            for(var i=0;i<tree.args.length;i++) {
                o = o.concat(jme.varsUsed(tree.args[i]));
            }
            return o;
        default:
            return [];
    }
};
/** Compare two trees.
 *
 * * Compare lists of variables lexically using {@link Numbas.jme.varsUsed}; longest goes first if one is a prefix of the other
 * * then monomials before anything else
 * * then by data type
 * * then by function name
 * * otherwise return 0
 *
 * @memberof Numbas.jme
 * @method
 * @param {Numbas.jme.tree} a
 * @param {Numbas.jme.tree} b
 * @returns {Number} -1 if `a` should appear to the left of `b`, 0 if equal, 1 if `a` should appear to the right of `b`
 */
var compareTrees = jme.compareTrees = function(a,b) {
    var sign_a = 1;
    while(jme.isOp(a.tok,'-u')) {
        a = a.args[0];
        sign_a *= -1;
    }
    var sign_b = 1;
    while(jme.isOp(b.tok,'-u')) {
        b = b.args[0];
        sign_b *= -1;
    }
    var va = jme.varsUsed(a);
    var vb = jme.varsUsed(b);
    for(var i=0;i<va.length;i++) {
        if(i>=vb.length) {
            return -1;
        }
        if(va[i]!=vb[i]) {
            return va[i]<vb[i] ? -1 : 1;
        }
    }
    if(vb.length>va.length) {
        return 1;
    }

    var ma = jme.isMonomial(a);
    var mb = jme.isMonomial(b);
    var isma = ma!==false;
    var ismb = mb!==false;
    if(isma!=ismb) {
        return isma ? -1 : 1;
    }
    if(isma && ismb && !(a.tok.type=='name' && b.tok.type=='name')) {
        var d = jme.compareTrees(ma.base,mb.base);
        if(d==0) {
            return ma.degree<mb.degree ? 1 : ma.degree>mb.degree ? -1 : compareTrees(ma.coefficient,mb.coefficient);
        } else {
            return d;
        }
    }

    if(a.tok.type!=b.tok.type) {
        var order = ['op','function'];
        var oa = order.indexOf(a.tok.type);
        var ob = order.indexOf(b.tok.type);
        if(oa!=ob) {
            return oa>ob ? -1 : 1;
        } else {
            return a.tok.type<b.tok.type ? -1 : 1;
        }
    }
    switch(a.tok.type) {
        case 'op':
        case 'function':
            function is_pow(t) {
                return t.tok.name=='^' || (t.tok.name=='*' && t.args[1].tok.name=='^') || (t.tok.name=='/' && t.args[1].tok.name=='^');
            }
            var pa = is_pow(a);
            var pb = is_pow(b);
            if(pa && !pb) {
                return -1;
            } else if(!pa && pb) {
                return 1;
            }
            if(a.tok.name!=b.tok.name) {
                return a.tok.name<b.tok.name ? -1 : 1;
            }
            if(a.args.length!=b.args.length) {
                return a.args.length<b.args.length ? -1 : 1;
            }
            for(var i=0;i<a.args.length;i++) {
                var c = jme.compareTrees(a.args[i],b.args[i]);
                if(c!=0) {
                    return c;
                }
            }
            break;
        case 'number':
            var na = a.tok.value;
            var nb = b.tok.value;
            if(na.complex || nb.complex) {
                na = na.complex ? na : {re:na,im:0};
                nb = nb.complex ? nb : {re:nb,im:0};
                var gt = na.re > nb.re || (na.re==nb.re && na.im>nb.im);
                var eq = na.re==nb.re && na.im==nb.im && sign_a==sign_b;
                return gt ? 1 : eq ? 0 : -1;
            } else {
                return a.tok.value<b.tok.value ? -1 : a.tok.value>b.tok.value ? 1 : sign_a==sign_b ? 0 : sign_a ? 1 : -1;
            }
    }
    return sign_a==sign_b ? 0 : sign_a ? 1 : -1;
}
});
