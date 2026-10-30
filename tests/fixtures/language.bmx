SuperStrict
Framework BRL.StandardIO
Import BRL.LinkedList
Import "other.bmx"
Include "shared.bmx"

Rem
bbdoc: A comment with "quotes", Type Fake and 'punctuation
The word EndReminder does not end this comment.
End Rem

?Win32 And x64
Const Mask:Int = $ff
?
Global total:Int = %1010
Local amount:Double = .5e+2
Local message:String = "A ~qquoted~q string~n"
Local longMessage:String = """Multiple
lines with "quotes" and 'apostrophes.
"""
Local items:Int[] = [1, 2, 3]
Local sum:Int = 1 + ..
    2

Interface IName
    Method Name:String()
End Interface

Type TExample Implements IName
    Field value:Int
    Method Name:String()
        If value > 0 Then
            Return "positive"
        Else
            Return "zero"
        EndIf
    End Method
    Method Compute:Int(x:Int) Abstract
    Method Operator +:Int(other:Int)
        Return value + other
    EndMethod
End Type

Struct SPoint
    Field x:Int, y:Int
EndStruct

Enum EColour
    Red
    Green
EndEnum

Extern "C"
    Function puts:Int(value:Byte Ptr)
    Global count:Int
End Extern

function Add:Int(a:Int, b:Int)
    For Local i:Int = 0 Until 2
        a :+ i
    Next
    Select b
        Case 0
            Return a
        Default
            Return a + b
    End Select
end function

Try
    Print Add(1, 2)
Catch error:Object
    DebugLog error.ToString()
EndTry
